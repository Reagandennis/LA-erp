'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import React, { useEffect, useMemo, useState } from 'react';

import { BRAND, ErrorBanner, FleetModal, Label, PageHeader, StatCard, formatNumber, inputClass, readNumber } from '@/app/modules/_components/fleet-ui';
import {
  type CardFillDto,
  DEFAULT_LOW_BALANCE_THRESHOLD,
  FUEL_CARD_ENTITIES,
  FUEL_CARD_PROVIDERS,
  type FuelCardDto,
  TOP_UP_KINDS,
  type TopUpDto,
  buildStatement,
  FUEL_CARD_ENTITY_LABELS,
  entityLabel,
  formatKes,
  isLowBalance,
} from '@/lib/fuel-cards';
import type { FleetVehicleRef } from '@/lib/fleet';
import { APP_LOCALE } from '@/lib/locale';
import { useSyncedState } from '@/app/ui/use-synced-state';

type CardForm = {
  name: string;
  provider: string;
  entity: string;
  /** '' for a spare. */
  vehicleId: string;
  cardNumber: string;
  lowBalanceThreshold: string;
  active: boolean;
  notes: string;
};

type TopUpForm = { kind: string; amount: string; occurredAt: string; reference: string; notes: string };

type Statement = { card: FuelCardDto; topUps: TopUpDto[]; fills: CardFillDto[] };

/** A strip in the provider's colours along the top of each card. */
const PROVIDER_STRIPE: Record<string, string> = {
  Shell: 'bg-[#FBCE07]',
  TotalEnergies: 'bg-gradient-to-r from-[#ED0000] via-[#F7A600] to-[#0055A4]',
};

function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString(APP_LOCALE, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

async function sendJson(url: string, method: string, body?: unknown): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, {
      method,
      credentials: 'include',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, error: (data as { error?: string } | null)?.error ?? 'Could not save.' };
    return { ok: true, data };
  } catch {
    return { ok: false, error: 'Something went wrong. Please try again.' };
  }
}

export default function FuelCardsClient({
  initialCards,
  initialCardId,
  vehicles,
  canOpenCarFuel,
}: {
  initialCards: FuelCardDto[];
  initialCardId: number | null;
  /** Our own vehicles, which cards can be issued to. */
  vehicles: FleetVehicleRef[];
  canOpenCarFuel: boolean;
}) {
  const router = useRouter();
  const [cards] = useSyncedState<FuelCardDto[]>(initialCards);
  const [selectedId, setSelectedId] = useState<number | null>(initialCardId);
  const [statement, setStatement] = useState<Statement | null>(null);
  const [statementError, setStatementError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [cardForm, setCardForm] = useState<CardForm | null>(null);
  const [editingCardId, setEditingCardId] = useState<number | null>(null);
  const [topUpForm, setTopUpForm] = useState<TopUpForm | null>(null);
  const [editingTopUp, setEditingTopUp] = useState<TopUpDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = cards.filter((c) => c.active);
  const retired = cards.filter((c) => !c.active);
  const selected = cards.find((c) => c.id === selectedId) ?? null;

  const stats = useMemo(
    () => ({
      balance: active.reduce((sum, c) => sum + c.balance, 0),
      low: active.filter((c) => isLowBalance(c.balance, c.lowBalanceThreshold)).length,
      spent: active.reduce((sum, c) => sum + c.spent, 0),
    }),
    [active],
  );

  // The statement follows the selected card, and reloads when its balance moves (someone else's
  // fill-up arrives through the live refresh) or after a save here.
  const selectedBalance = selected?.balance;
  const selectedFills = selected?.fills;
  useEffect(() => {
    if (selectedId == null) return;
    let live = true;
    void (async () => {
      const result = await sendJson(`/api/fleet/fuel-cards/${selectedId}`, 'GET');
      if (!live) return;
      if (result.ok) {
        setStatement(result.data as Statement);
        setStatementError(null);
      } else {
        setStatementError(result.error);
      }
    })();
    return () => {
      live = false;
    };
  }, [selectedId, selectedBalance, selectedFills, reloadKey]);

  const entries = useMemo(
    () => (statement && statement.card.id === selectedId ? buildStatement(statement.topUps, statement.fills) : []),
    [statement, selectedId],
  );

  const afterSave = () => {
    setReloadKey((k) => k + 1);
    router.refresh();
  };

  // --- Card form ----------------------------------------------------------------

  const openNewCard = () => {
    setEditingCardId(null);
    setError(null);
    setCardForm({
      name: '',
      provider: 'Shell',
      entity: 'LADYASKARI',
      vehicleId: '',
      cardNumber: '',
      lowBalanceThreshold: String(DEFAULT_LOW_BALANCE_THRESHOLD),
      active: true,
      notes: '',
    });
  };

  const openEditCard = (card: FuelCardDto) => {
    setEditingCardId(card.id);
    setError(null);
    setCardForm({
      name: card.name,
      provider: card.provider,
      entity: card.entity,
      vehicleId: card.vehicle ? String(card.vehicle.id) : '',
      cardNumber: card.cardNumber ?? '',
      lowBalanceThreshold: String(card.lowBalanceThreshold),
      active: card.active,
      notes: card.notes ?? '',
    });
  };

  const closeCardForm = () => {
    setCardForm(null);
    setEditingCardId(null);
    setError(null);
  };

  const saveCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cardForm) return;
    let body: Record<string, unknown>;
    try {
      if (!cardForm.name.trim()) throw new Error('Name the card.');
      const threshold = readNumber(cardForm.lowBalanceThreshold, 'Alert level');
      body = {
        name: cardForm.name.trim(),
        provider: cardForm.provider,
        entity: cardForm.entity,
        vehicleId: cardForm.vehicleId ? Number(cardForm.vehicleId) : null,
        cardNumber: cardForm.cardNumber.trim() || null,
        lowBalanceThreshold: threshold ?? 0,
        active: cardForm.active,
        notes: cardForm.notes.trim() || null,
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Check the form.');
      return;
    }
    setBusy(true);
    const result = await sendJson(editingCardId ? `/api/fleet/fuel-cards/${editingCardId}` : '/api/fleet/fuel-cards', editingCardId ? 'PATCH' : 'POST', body);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const saved = (result.data as { item: FuelCardDto }).item;
    setSelectedId(saved.id);
    closeCardForm();
    afterSave();
  };

  const deleteCard = async () => {
    if (!editingCardId || !window.confirm('Delete this card? This cannot be undone.')) return;
    setBusy(true);
    const result = await sendJson(`/api/fleet/fuel-cards/${editingCardId}`, 'DELETE');
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (selectedId === editingCardId) setSelectedId(active.find((c) => c.id !== editingCardId)?.id ?? null);
    closeCardForm();
    afterSave();
  };

  // --- Top-up form --------------------------------------------------------------

  const openTopUp = (card: FuelCardDto, topUp?: TopUpDto) => {
    setSelectedId(card.id);
    setEditingTopUp(topUp ?? null);
    setError(null);
    setTopUpForm(
      topUp
        ? {
            kind: topUp.kind,
            amount: String(topUp.amount),
            occurredAt: toLocalInput(new Date(topUp.occurredAt)),
            reference: topUp.reference ?? '',
            notes: topUp.notes ?? '',
          }
        : { kind: 'Top-up', amount: '', occurredAt: toLocalInput(new Date()), reference: '', notes: '' },
    );
  };

  const closeTopUp = () => {
    setTopUpForm(null);
    setEditingTopUp(null);
    setError(null);
  };

  const saveTopUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topUpForm || selectedId == null) return;
    let body: Record<string, unknown>;
    try {
      const amount = readNumber(topUpForm.amount, 'Amount');
      if (amount === null || amount === 0) throw new Error('Enter an amount.');
      if (topUpForm.kind === 'Top-up' && amount < 0) throw new Error('A top-up must be more than 0; use an adjustment to take money off.');
      const occurredAt = new Date(topUpForm.occurredAt);
      if (!topUpForm.occurredAt || Number.isNaN(occurredAt.getTime())) throw new Error('Enter when the money was loaded.');
      body = {
        kind: topUpForm.kind,
        amount,
        occurredAt: occurredAt.toISOString(),
        reference: topUpForm.reference.trim() || null,
        notes: topUpForm.notes.trim() || null,
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Check the form.');
      return;
    }
    setBusy(true);
    const base = `/api/fleet/fuel-cards/${selectedId}/top-ups`;
    const result = await sendJson(editingTopUp ? `${base}/${editingTopUp.id}` : base, editingTopUp ? 'PATCH' : 'POST', body);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    closeTopUp();
    afterSave();
  };

  const deleteTopUp = async () => {
    if (!editingTopUp || selectedId == null || !window.confirm('Delete this entry? The card balance changes with it.')) return;
    setBusy(true);
    const result = await sendJson(`/api/fleet/fuel-cards/${selectedId}/top-ups/${editingTopUp.id}`, 'DELETE');
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    closeTopUp();
    afterSave();
  };

  // --- Render -------------------------------------------------------------------

  const renderCard = (card: FuelCardDto) => {
    const low = card.active && isLowBalance(card.balance, card.lowBalanceThreshold);
    const isSelected = card.id === selectedId;
    return (
      <div
        key={card.id}
        className={`relative bg-white rounded-2xl border overflow-hidden transition-shadow ${
          isSelected ? 'border-[#03458f] shadow-md' : 'border-gray-100 hover:shadow-sm'
        } ${card.active ? '' : 'opacity-70'}`}
      >
        <div className={`h-1.5 ${PROVIDER_STRIPE[card.provider] ?? 'bg-gray-300'}`} />
        <button type="button" onClick={() => setSelectedId(card.id)} className="block w-full text-left p-4" aria-pressed={isSelected}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-semibold text-gray-900 truncate">{card.name}</p>
              <p className="text-xs text-gray-400 truncate">
                {[card.vehicle ? card.vehicle.registration : 'Spare: any vehicle', card.provider, card.cardNumber].filter(Boolean).join(' · ')}
              </p>
            </div>
            {!card.active ? (
              <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-500">Retired</span>
            ) : low ? (
              <span className="shrink-0 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-700">
                {card.balance < 0 ? 'Overdrawn' : 'Low'}
              </span>
            ) : null}
          </div>
          <p className={`mt-3 text-2xl font-semibold tabular-nums ${low ? 'text-rose-600' : 'text-gray-900'}`}>{formatKes(card.balance)}</p>
          <p className="text-[11px] text-gray-400 mt-0.5">
            Alert below {formatKes(card.lowBalanceThreshold)} · {formatNumber(card.fills)} fill-up{card.fills === 1 ? '' : 's'}
          </p>
        </button>
        <div className="flex border-t border-gray-100 text-xs font-semibold">
          {card.active && (
            <button type="button" onClick={() => openTopUp(card)} className="flex-1 py-2.5 text-[#03458f] hover:bg-gray-50">
              Top up
            </button>
          )}
          <button type="button" onClick={() => openEditCard(card)} className="flex-1 py-2.5 text-gray-600 hover:bg-gray-50 border-l border-gray-100">
            Edit
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-10">
      <div className="max-w-6xl mx-auto">
        <PageHeader
          title="Fuel Cards"
          subtitle="Prepaid cards the internal fleet fills up on. Fill-ups paid with a card come off its balance; admins are alerted when one runs low."
          actionLabel="New card"
          onAction={openNewCard}
        />

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
          <StatCard label="Active cards" value={formatNumber(active.length)} />
          <StatCard label="Total balance" value={formatKes(stats.balance)} hint="Across active cards" />
          <StatCard label="Below alert level" value={formatNumber(stats.low)} hint={stats.low > 0 ? 'Top up soon' : 'All cards healthy'} />
          <StatCard label="Spent on cards" value={formatKes(stats.spent)} hint="All time, active cards" />
        </div>

        {error && !cardForm && !topUpForm && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

        {cards.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-gray-200">
            <p className="text-gray-900 font-medium">No fuel cards yet</p>
            <p className="text-gray-500 text-sm mt-1">Add the fleet’s first card to start tracking its balance.</p>
          </div>
        ) : (
          <>
            {Object.keys(FUEL_CARD_ENTITY_LABELS)
              .concat(active.map((c) => c.entity).filter((e) => !(e in FUEL_CARD_ENTITY_LABELS)))
              .filter((entity, i, all) => all.indexOf(entity) === i)
              .map((entity) => {
                const group = active.filter((c) => c.entity === entity);
                if (group.length === 0) return null;
                const groupBalance = group.reduce((sum, c) => sum + c.balance, 0);
                return (
                  <section key={entity} className="mb-8">
                    <h2 className="text-sm font-semibold text-gray-900 mb-3">
                      {entityLabel(entity)}
                      <span className="ml-2 font-normal text-gray-400">
                        {formatNumber(group.length)} card{group.length === 1 ? '' : 's'} · {formatKes(groupBalance)}
                      </span>
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{group.map(renderCard)}</div>
                  </section>
                );
              })}
            {retired.length > 0 && (
              <>
                <h2 className="text-sm font-semibold text-gray-500 mt-8 mb-3">Retired</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{retired.map(renderCard)}</div>
              </>
            )}
          </>
        )}

        {selected && (
          <div className="mt-10">
            <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Statement · {selected.name}</h2>
                <p className="text-xs text-gray-400">
                  Loaded {formatKes(selected.loaded)} · spent {formatKes(selected.spent)} · balance {formatKes(selected.balance)}
                </p>
              </div>
              {selected.active && (
                <button type="button" onClick={() => openTopUp(selected)} className="text-sm font-semibold text-[#03458f] hover:underline">
                  + Top-up or adjustment
                </button>
              )}
            </div>
            {statementError ? (
              <ErrorBanner message={statementError} onDismiss={() => setStatementError(null)} />
            ) : entries.length === 0 ? (
              <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-gray-200 text-sm text-gray-500">
                Nothing on this card yet. Record the money on it as its first top-up.
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                      <th className="px-4 py-3 font-medium">Date</th>
                      <th className="px-4 py-3 font-medium">Entry</th>
                      <th className="px-4 py-3 font-medium">Detail</th>
                      <th className="px-4 py-3 font-medium text-right">Amount</th>
                      <th className="px-4 py-3 font-medium text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry) => {
                      const editable = entry.topUp != null;
                      return (
                        <tr
                          key={entry.key}
                          onClick={editable ? () => openTopUp(selected, entry.topUp) : undefined}
                          className={`border-b border-gray-50 last:border-0 ${editable ? 'hover:bg-gray-50/70 cursor-pointer' : ''}`}
                        >
                          <td className="px-4 py-3 whitespace-nowrap text-gray-700">{formatWhen(entry.at)}</td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span
                              className={`mr-2 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                entry.kind === 'Fill-up' ? 'bg-gray-100 text-gray-600' : 'bg-emerald-100 text-emerald-700'
                              }`}
                            >
                              {entry.kind}
                            </span>
                            {entry.kind === 'Fill-up' && <span className="font-medium text-gray-900">{entry.title}</span>}
                          </td>
                          <td className="px-4 py-3 text-gray-500 max-w-[16rem] truncate">{entry.detail ?? '—'}</td>
                          <td
                            className={`px-4 py-3 text-right tabular-nums whitespace-nowrap ${entry.amount < 0 ? 'text-gray-900' : 'text-emerald-700'}`}
                          >
                            {entry.amount > 0 ? '+' : ''}
                            {formatKes(entry.amount)}
                          </td>
                          <td
                            className={`px-4 py-3 text-right tabular-nums whitespace-nowrap font-medium ${
                              isLowBalance(entry.balanceAfter, selected.lowBalanceThreshold) ? 'text-rose-600' : 'text-gray-900'
                            }`}
                          >
                            {formatKes(entry.balanceAfter)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {canOpenCarFuel && (
              <p className="mt-3 text-xs text-gray-400">
                Fill-ups are logged, edited and deleted in{' '}
                <Link href="/modules/car-fuel" className="font-semibold text-[#03458f] hover:underline">
                  Car Fuel
                </Link>
                ; the balance follows.
              </p>
            )}
          </div>
        )}
      </div>

      {cardForm && (
        <FleetModal
          title={editingCardId ? 'Edit fuel card' : 'New fuel card'}
          onClose={closeCardForm}
          error={error}
          onSubmit={saveCard}
          footer={
            <>
              {editingCardId ? (
                <button
                  type="button"
                  onClick={deleteCard}
                  disabled={busy}
                  className="px-4 py-2.5 rounded-xl border border-rose-200 text-sm font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                >
                  Delete
                </button>
              ) : (
                <button
                  type="button"
                  onClick={closeCardForm}
                  className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50"
                >
                  Cancel
                </button>
              )}
              <button
                type="submit"
                disabled={busy}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm disabled:opacity-50"
                style={{ backgroundColor: BRAND }}
              >
                {busy ? 'Saving…' : editingCardId ? 'Save changes' : 'Add card'}
              </button>
            </>
          }
        >
          <div>
            <Label>Card name *</Label>
            <input
              className={inputClass}
              value={cardForm.name}
              onChange={(e) => setCardForm({ ...cardForm, name: e.target.value })}
              placeholder="e.g. Shell Fuel Card – Lioness"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Provider</Label>
              <select className={inputClass} value={cardForm.provider} onChange={(e) => setCardForm({ ...cardForm, provider: e.target.value })}>
                {FUEL_CARD_PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Company</Label>
              <select className={inputClass} value={cardForm.entity} onChange={(e) => setCardForm({ ...cardForm, entity: e.target.value })}>
                {FUEL_CARD_ENTITIES.map((entity) => (
                  <option key={entity} value={entity}>
                    {entityLabel(entity)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <Label>Vehicle</Label>
            <select className={inputClass} value={cardForm.vehicleId} onChange={(e) => setCardForm({ ...cardForm, vehicleId: e.target.value })}>
              <option value="">Spare: any internal vehicle</option>
              {vehicles.map((v) => (
                <option key={v.id} value={String(v.id)}>
                  {[v.registration, v.make, v.model].filter(Boolean).join(' · ')}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-400">A card issued to a vehicle pays only for that vehicle’s fill-ups.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Card number</Label>
              <input
                className={inputClass}
                value={cardForm.cardNumber}
                onChange={(e) => setCardForm({ ...cardForm, cardNumber: e.target.value })}
                placeholder="Last 4 digits is enough"
              />
            </div>
            <div>
              <Label>Alert below (KES)</Label>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="1"
                className={inputClass}
                value={cardForm.lowBalanceThreshold}
                onChange={(e) => setCardForm({ ...cardForm, lowBalanceThreshold: e.target.value })}
              />
            </div>
          </div>
          {editingCardId && (
            <label className="flex items-start gap-2.5 text-sm text-gray-700">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-gray-300"
                checked={!cardForm.active}
                onChange={(e) => setCardForm({ ...cardForm, active: !e.target.checked })}
              />
              <span>
                Retired
                <span className="block text-xs text-gray-400">A retired card keeps its history but can’t pay for new fill-ups.</span>
              </span>
            </label>
          )}
          <div>
            <Label>Notes</Label>
            <textarea rows={2} className={inputClass} value={cardForm.notes} onChange={(e) => setCardForm({ ...cardForm, notes: e.target.value })} placeholder="Optional" />
          </div>
        </FleetModal>
      )}

      {topUpForm && selected && (
        <FleetModal
          title={`${editingTopUp ? 'Edit' : 'Record'} ${topUpForm.kind === 'Adjustment' ? 'adjustment' : 'top-up'} · ${selected.name}`}
          onClose={closeTopUp}
          error={error}
          onSubmit={saveTopUp}
          footer={
            <>
              {editingTopUp ? (
                <button
                  type="button"
                  onClick={deleteTopUp}
                  disabled={busy}
                  className="px-4 py-2.5 rounded-xl border border-rose-200 text-sm font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                >
                  Delete
                </button>
              ) : (
                <button
                  type="button"
                  onClick={closeTopUp}
                  className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50"
                >
                  Cancel
                </button>
              )}
              <button
                type="submit"
                disabled={busy}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm disabled:opacity-50"
                style={{ backgroundColor: BRAND }}
              >
                {busy ? 'Saving…' : 'Save'}
              </button>
            </>
          }
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Type</Label>
              <select className={inputClass} value={topUpForm.kind} onChange={(e) => setTopUpForm({ ...topUpForm, kind: e.target.value })}>
                {TOP_UP_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Amount (KES) *</Label>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                className={inputClass}
                value={topUpForm.amount}
                onChange={(e) => setTopUpForm({ ...topUpForm, amount: e.target.value })}
                placeholder={topUpForm.kind === 'Adjustment' ? 'Negative takes money off' : 'e.g. 50000'}
              />
            </div>
          </div>
          <div>
            <Label>Date &amp; time *</Label>
            <input
              type="datetime-local"
              className={inputClass}
              value={topUpForm.occurredAt}
              onChange={(e) => setTopUpForm({ ...topUpForm, occurredAt: e.target.value })}
            />
          </div>
          <div>
            <Label>Reference</Label>
            <input
              className={inputClass}
              value={topUpForm.reference}
              onChange={(e) => setTopUpForm({ ...topUpForm, reference: e.target.value })}
              placeholder="Receipt, M-Pesa or bank reference"
            />
          </div>
          <div>
            <Label>Notes</Label>
            <textarea rows={2} className={inputClass} value={topUpForm.notes} onChange={(e) => setTopUpForm({ ...topUpForm, notes: e.target.value })} placeholder="Optional" />
          </div>
          {topUpForm.kind === 'Adjustment' && (
            <p className="-mt-2 text-xs text-gray-400">Use an adjustment to match the balance to the provider’s statement, either way.</p>
          )}
        </FleetModal>
      )}
    </div>
  );
}
