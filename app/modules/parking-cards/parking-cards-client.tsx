'use client';

import { useRouter } from 'next/navigation';
import React, { useEffect, useMemo, useState } from 'react';

import { BRAND, ErrorBanner, FleetModal, Label, PageHeader, StatCard, formatNumber, inputClass, readNumber } from '@/app/modules/_components/fleet-ui';
import { useSyncedState } from '@/app/ui/use-synced-state';
import type { FleetVehicleRef } from '@/lib/fleet';
import { formatKes } from '@/lib/fuel-cards';
import { APP_LOCALE } from '@/lib/locale';
import {
  PARKING_PROVIDERS,
  type ParkingCardDto,
  type ParkingEntryDto,
  defaultParkingThreshold,
  isParkingLow,
  parkingStatement,
} from '@/lib/parking-cards';

type CardForm = { name: string; provider: string; vehicleId: string; cardNumber: string; lowBalanceThreshold: string; active: boolean; notes: string };
type EntryKind = 'Parking' | 'Top-up' | 'Balance check';
type EntryForm = { kind: EntryKind; amount: string; occurredAt: string; vehicleId: string; location: string; reference: string; notes: string };

const PROVIDER_STRIPE: Record<string, string> = {
  KAPS: 'bg-[#0b7a3e]',
  PAYTECH: 'bg-[#1d4ed8]',
  'PARK n GO': 'bg-[#f59e0b]',
  'Express Way': 'bg-[#b91c1c]',
};

const toLocalInput = (date: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString(APP_LOCALE, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

async function sendJson(url: string, method: string, body?: unknown): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, {
      method,
      credentials: 'include',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    return res.ok ? { ok: true, data } : { ok: false, error: (data as { error?: string } | null)?.error ?? 'Could not save.' };
  } catch {
    return { ok: false, error: 'Something went wrong. Please try again.' };
  }
}

export default function ParkingCardsClient({
  initialCards,
  initialCardId,
  vehicles,
}: {
  initialCards: ParkingCardDto[];
  initialCardId: number | null;
  vehicles: FleetVehicleRef[];
}) {
  const router = useRouter();
  const [cards] = useSyncedState<ParkingCardDto[]>(initialCards);
  const [selectedId, setSelectedId] = useState<number | null>(initialCardId);
  const [entries, setEntries] = useState<{ cardId: number; items: ParkingEntryDto[] } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [cardForm, setCardForm] = useState<CardForm | null>(null);
  const [editingCardId, setEditingCardId] = useState<number | null>(null);
  const [entryForm, setEntryForm] = useState<EntryForm | null>(null);
  const [editingEntry, setEditingEntry] = useState<ParkingEntryDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = cards.filter((c) => c.active);
  const retired = cards.filter((c) => !c.active);
  const selected = cards.find((c) => c.id === selectedId) ?? null;
  const low = active.filter(isParkingLow);

  const selectedBalance = selected?.balance;
  const selectedCount = selected?.entries;
  useEffect(() => {
    if (selectedId == null) return;
    let live = true;
    void sendJson(`/api/fleet/parking-cards/${selectedId}`, 'GET').then((result) => {
      if (live && result.ok) setEntries({ cardId: selectedId, items: (result.data as { entries: ParkingEntryDto[] }).entries });
      if (live && !result.ok) setError(result.error);
    });
    return () => {
      live = false;
    };
  }, [selectedId, selectedBalance, selectedCount, reloadKey]);

  const statement = useMemo(
    () => (entries && entries.cardId === selectedId ? parkingStatement(entries.items) : []),
    [entries, selectedId],
  );

  const afterSave = () => {
    setReloadKey((k) => k + 1);
    router.refresh();
  };

  // --- Card form --------------------------------------------------------------------------

  const openCard = (card?: ParkingCardDto) => {
    setEditingCardId(card?.id ?? null);
    setError(null);
    setCardForm({
      name: card?.name ?? '',
      provider: card?.provider ?? 'KAPS',
      vehicleId: card?.vehicle ? String(card.vehicle.id) : '',
      cardNumber: card?.cardNumber ?? '',
      lowBalanceThreshold: String(card?.lowBalanceThreshold ?? defaultParkingThreshold('KAPS')),
      active: card?.active ?? true,
      notes: card?.notes ?? '',
    });
  };

  const saveCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cardForm) return;
    if (!cardForm.name.trim()) return setError('Name the card.');
    let threshold: number | null;
    try {
      threshold = readNumber(cardForm.lowBalanceThreshold, 'Low level');
    } catch (err) {
      return setError(err instanceof Error ? err.message : 'Check the form.');
    }
    setBusy(true);
    const result = await sendJson(
      editingCardId ? `/api/fleet/parking-cards/${editingCardId}` : '/api/fleet/parking-cards',
      editingCardId ? 'PATCH' : 'POST',
      {
        name: cardForm.name.trim(),
        provider: cardForm.provider,
        vehicleId: cardForm.vehicleId ? Number(cardForm.vehicleId) : null,
        cardNumber: cardForm.cardNumber.trim() || null,
        lowBalanceThreshold: threshold ?? defaultParkingThreshold(cardForm.provider),
        active: cardForm.active,
        notes: cardForm.notes.trim() || null,
      },
    );
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setSelectedId((result.data as { item: ParkingCardDto }).item.id);
    setCardForm(null);
    afterSave();
  };

  const deleteCard = async () => {
    if (!editingCardId || !window.confirm('Delete this card? This cannot be undone.')) return;
    setBusy(true);
    const result = await sendJson(`/api/fleet/parking-cards/${editingCardId}`, 'DELETE');
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setCardForm(null);
    afterSave();
  };

  // --- Entry form -------------------------------------------------------------------------

  const openEntry = (card: ParkingCardDto, kind: EntryKind, entry?: ParkingEntryDto) => {
    setSelectedId(card.id);
    setEditingEntry(entry ?? null);
    setError(null);
    setEntryForm({
      kind,
      amount: entry ? String(Math.abs(entry.amount)) : '',
      occurredAt: toLocalInput(entry ? new Date(entry.occurredAt) : new Date()),
      vehicleId: entry?.vehicle ? String(entry.vehicle.id) : card.vehicle && kind === 'Parking' ? String(card.vehicle.id) : '',
      location: entry?.location ?? '',
      reference: entry?.reference ?? '',
      notes: entry?.notes ?? '',
    });
  };

  const saveEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!entryForm || selectedId == null) return;
    let value: number | null;
    try {
      value = readNumber(entryForm.amount, entryForm.kind === 'Balance check' ? 'Balance' : 'Amount');
    } catch (err) {
      return setError(err instanceof Error ? err.message : 'Check the form.');
    }
    if (value === null) return setError(entryForm.kind === 'Balance check' ? 'Enter the balance the card showed.' : 'Enter an amount.');
    if (entryForm.kind !== 'Balance check' && value <= 0) return setError('Enter an amount more than 0.');
    const occurredAt = new Date(entryForm.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) return setError('Enter the date and time.');
    const body: Record<string, unknown> = {
      occurredAt: occurredAt.toISOString(),
      vehicleId: entryForm.vehicleId ? Number(entryForm.vehicleId) : null,
      location: entryForm.location.trim() || null,
      reference: entryForm.reference.trim() || null,
      notes: entryForm.notes.trim() || null,
    };
    if (editingEntry) body.amount = value;
    else {
      body.kind = entryForm.kind;
      if (entryForm.kind === 'Balance check') body.observedBalance = value;
      else body.amount = value;
    }
    setBusy(true);
    const base = `/api/fleet/parking-cards/${selectedId}/entries`;
    const result = await sendJson(editingEntry ? `${base}/${editingEntry.id}` : base, editingEntry ? 'PATCH' : 'POST', body);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setEntryForm(null);
    setEditingEntry(null);
    afterSave();
  };

  const deleteEntry = async () => {
    if (!editingEntry || selectedId == null || !window.confirm('Delete this entry? The card balance changes with it.')) return;
    setBusy(true);
    const result = await sendJson(`/api/fleet/parking-cards/${selectedId}/entries/${editingEntry.id}`, 'DELETE');
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setEntryForm(null);
    setEditingEntry(null);
    afterSave();
  };

  // --- Render -----------------------------------------------------------------------------

  const renderCard = (card: ParkingCardDto) => {
    const isLow = isParkingLow(card);
    const isSelected = card.id === selectedId;
    return (
      <div
        key={card.id}
        className={`bg-white rounded-2xl border overflow-hidden ${isSelected ? 'border-[#03458f] shadow-md' : 'border-gray-100 hover:shadow-sm'} ${
          card.active ? '' : 'opacity-70'
        }`}
      >
        <div className={`h-1.5 ${PROVIDER_STRIPE[card.provider] ?? 'bg-gray-300'}`} />
        <button type="button" onClick={() => setSelectedId(card.id)} className="block w-full p-4 text-left" aria-pressed={isSelected}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-semibold text-gray-900">{card.name}</p>
              <p className="truncate text-xs text-gray-400">
                {[card.vehicle ? card.vehicle.registration : 'Shared / spare', card.cardNumber].filter(Boolean).join(' · ')}
              </p>
            </div>
            {!card.active ? (
              <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-500">Retired</span>
            ) : isLow ? (
              <span className="shrink-0 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-700">Top up</span>
            ) : null}
          </div>
          <p className={`mt-3 text-2xl font-semibold tabular-nums ${isLow ? 'text-rose-600' : 'text-gray-900'}`}>{formatKes(card.balance)}</p>
          <p className="mt-0.5 text-[11px] text-gray-400">
            Keep above {formatKes(card.lowBalanceThreshold)}
            {card.lastEntryAt ? ` · last entry ${new Date(card.lastEntryAt).toLocaleDateString(APP_LOCALE, { day: 'numeric', month: 'short' })}` : ''}
          </p>
        </button>
        <div className="grid grid-cols-4 border-t border-gray-100 text-[11px] font-semibold">
          {card.active && (
            <>
              <button type="button" onClick={() => openEntry(card, 'Parking')} className="py-2.5 text-[#03458f] hover:bg-gray-50">
                Log parking
              </button>
              <button type="button" onClick={() => openEntry(card, 'Top-up')} className="border-l border-gray-100 py-2.5 text-[#03458f] hover:bg-gray-50">
                Top up
              </button>
              <button type="button" onClick={() => openEntry(card, 'Balance check')} className="border-l border-gray-100 py-2.5 text-gray-600 hover:bg-gray-50">
                Check balance
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => openCard(card)}
            className={`py-2.5 text-gray-600 hover:bg-gray-50 ${card.active ? 'border-l border-gray-100' : 'col-span-4'}`}
          >
            Edit
          </button>
        </div>
      </div>
    );
  };

  const providers = [...PARKING_PROVIDERS, ...active.map((c) => c.provider)].filter((p, i, all) => all.indexOf(p) === i);
  const entryTitle = entryForm
    ? `${editingEntry ? 'Edit' : entryForm.kind === 'Parking' ? 'Log' : 'Record'} ${entryForm.kind === 'Balance check' ? 'balance check' : entryForm.kind.toLowerCase()} · ${selected?.name ?? ''}`
    : '';

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-10">
      <div className="mx-auto max-w-6xl">
        <PageHeader
          title="Parking Cards"
          subtitle="KAPS, PAYTECH, PARK n GO and Express Way cards. Log parking and top-ups here; check the balance by USSD once a week and record it."
          actionLabel="New card"
          onAction={() => openCard()}
        />

        <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Active cards" value={formatNumber(active.length)} />
          <StatCard label="Total balance" value={formatKes(active.reduce((sum, c) => sum + c.balance, 0))} hint="Across active cards" />
          <StatCard label="Need a top-up" value={formatNumber(low.length)} hint={low.length ? low.map((c) => c.name).join(', ') : 'All above their minimum'} />
          <StatCard label="Top up with" value="KES 1,000" hint="Express Way: keep KES 10,000" />
        </div>

        {error && !cardForm && !entryForm && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

        {cards.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-white py-20 text-center">
            <p className="font-medium text-gray-900">No parking cards yet</p>
            <p className="mt-1 text-sm text-gray-500">Add the fleet’s first card to start tracking it.</p>
          </div>
        ) : (
          providers.map((provider) => {
            const group = active.filter((c) => c.provider === provider);
            if (group.length === 0) return null;
            return (
              <section key={provider} className="mb-8">
                <h2 className="mb-3 text-sm font-semibold text-gray-900">
                  {provider}
                  <span className="ml-2 font-normal text-gray-400">
                    {formatNumber(group.length)} card{group.length === 1 ? '' : 's'} · {formatKes(group.reduce((sum, c) => sum + c.balance, 0))}
                  </span>
                </h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{group.map(renderCard)}</div>
              </section>
            );
          })
        )}
        {retired.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-3 text-sm font-semibold text-gray-500">Retired</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{retired.map(renderCard)}</div>
          </section>
        )}

        {selected && (
          <div className="mt-6">
            <h2 className="text-sm font-semibold text-gray-900">Statement · {selected.name}</h2>
            <p className="mb-3 text-xs text-gray-400">Balance {formatKes(selected.balance)} · click a parking or top-up line to correct it</p>
            {statement.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-200 bg-white py-12 text-center text-sm text-gray-500">
                Nothing on this card yet. Record a balance check to start it at what the card shows.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-gray-100 bg-white">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-left text-xs text-gray-400">
                      <th className="px-4 py-3 font-medium">Date</th>
                      <th className="px-4 py-3 font-medium">Entry</th>
                      <th className="px-4 py-3 font-medium">Vehicle</th>
                      <th className="px-4 py-3 font-medium">Where / for</th>
                      <th className="px-4 py-3 font-medium">By</th>
                      <th className="px-4 py-3 text-right font-medium">Amount</th>
                      <th className="px-4 py-3 text-right font-medium">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statement.map((line) => (
                      <tr
                        key={line.id}
                        onClick={() => openEntry(selected, line.kind as EntryKind, line)}
                        className="cursor-pointer border-b border-gray-50 last:border-0 hover:bg-gray-50/70"
                      >
                        <td className="whitespace-nowrap px-4 py-3 text-gray-700">{formatWhen(line.occurredAt)}</td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                              line.kind === 'Parking'
                                ? 'bg-gray-100 text-gray-600'
                                : line.kind === 'Top-up'
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : 'bg-sky-100 text-sky-700'
                            }`}
                          >
                            {line.kind}
                          </span>
                          {line.observedBalance != null && <span className="ml-2 text-xs text-gray-400">showed {formatKes(line.observedBalance)}</span>}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-gray-700">{line.vehicle?.registration ?? '—'}</td>
                        <td className="max-w-[16rem] truncate px-4 py-3 text-gray-500">
                          {[line.location, line.reference, line.notes].filter(Boolean).join(' · ') || '—'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-gray-500">{line.createdBy?.name ?? '—'}</td>
                        <td className={`whitespace-nowrap px-4 py-3 text-right tabular-nums ${line.amount < 0 ? 'text-gray-900' : 'text-emerald-700'}`}>
                          {line.amount > 0 ? '+' : ''}
                          {formatKes(line.amount)}
                        </td>
                        <td
                          className={`whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums ${
                            line.balanceAfter < selected.lowBalanceThreshold ? 'text-rose-600' : 'text-gray-900'
                          }`}
                        >
                          {formatKes(line.balanceAfter)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {cardForm && (
        <FleetModal
          title={editingCardId ? 'Edit parking card' : 'New parking card'}
          onClose={() => setCardForm(null)}
          error={error}
          onSubmit={saveCard}
          footer={
            <>
              {editingCardId ? (
                <button type="button" onClick={deleteCard} disabled={busy} className="rounded-xl border border-rose-200 px-4 py-2.5 text-sm font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50">
                  Delete
                </button>
              ) : (
                <button type="button" onClick={() => setCardForm(null)} className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50">
                  Cancel
                </button>
              )}
              <button type="submit" disabled={busy} className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white shadow-sm disabled:opacity-50" style={{ backgroundColor: BRAND }}>
                {busy ? 'Saving…' : editingCardId ? 'Save changes' : 'Add card'}
              </button>
            </>
          }
        >
          <div>
            <Label>Card name *</Label>
            <input className={inputClass} value={cardForm.name} onChange={(e) => setCardForm({ ...cardForm, name: e.target.value })} placeholder="e.g. KDK 241R · PAYTECH" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label>Provider</Label>
              <select
                className={inputClass}
                value={cardForm.provider}
                onChange={(e) => {
                  const provider = e.target.value;
                  // Follow the provider's usual minimum unless someone already changed it.
                  const usual = String(defaultParkingThreshold(cardForm.provider));
                  setCardForm({ ...cardForm, provider, lowBalanceThreshold: cardForm.lowBalanceThreshold === usual ? String(defaultParkingThreshold(provider)) : cardForm.lowBalanceThreshold });
                }}
              >
                {PARKING_PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Vehicle</Label>
              <select className={inputClass} value={cardForm.vehicleId} onChange={(e) => setCardForm({ ...cardForm, vehicleId: e.target.value })}>
                <option value="">Shared / spare</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={String(v.id)}>
                    {v.registration}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label>Card number</Label>
              <input className={inputClass} value={cardForm.cardNumber} onChange={(e) => setCardForm({ ...cardForm, cardNumber: e.target.value })} placeholder="Last digits is enough" />
            </div>
            <div>
              <Label>Keep above (KES)</Label>
              <input type="number" min={0} step="1" className={inputClass} value={cardForm.lowBalanceThreshold} onChange={(e) => setCardForm({ ...cardForm, lowBalanceThreshold: e.target.value })} />
            </div>
          </div>
          {editingCardId && (
            <label className="flex items-start gap-2.5 text-sm text-gray-700">
              <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-gray-300" checked={!cardForm.active} onChange={(e) => setCardForm({ ...cardForm, active: !e.target.checked })} />
              <span>
                Retired
                <span className="block text-xs text-gray-400">Keeps its history but takes no new entries.</span>
              </span>
            </label>
          )}
          <div>
            <Label>Notes</Label>
            <textarea rows={2} className={inputClass} value={cardForm.notes} onChange={(e) => setCardForm({ ...cardForm, notes: e.target.value })} placeholder="How to top it up, who it shows on payment…" />
          </div>
        </FleetModal>
      )}

      {entryForm && selected && (
        <FleetModal
          title={entryTitle}
          onClose={() => {
            setEntryForm(null);
            setEditingEntry(null);
          }}
          error={error}
          onSubmit={saveEntry}
          footer={
            <>
              {editingEntry ? (
                <button type="button" onClick={deleteEntry} disabled={busy} className="rounded-xl border border-rose-200 px-4 py-2.5 text-sm font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50">
                  Delete
                </button>
              ) : (
                <button type="button" onClick={() => setEntryForm(null)} className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50">
                  Cancel
                </button>
              )}
              {!(editingEntry && editingEntry.kind === 'Balance check') && (
                <button type="submit" disabled={busy} className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white shadow-sm disabled:opacity-50" style={{ backgroundColor: BRAND }}>
                  {busy ? 'Saving…' : 'Save'}
                </button>
              )}
            </>
          }
        >
          {editingEntry?.kind === 'Balance check' ? (
            <p className="text-sm text-gray-600">
              A balance check can’t be edited. Delete it and record the check again if the figure was wrong.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label>{entryForm.kind === 'Balance check' ? 'Balance the card showed (KES) *' : 'Amount (KES) *'}</Label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    className={inputClass}
                    value={entryForm.amount}
                    onChange={(e) => setEntryForm({ ...entryForm, amount: e.target.value })}
                    placeholder={entryForm.kind === 'Parking' ? 'e.g. 150' : entryForm.kind === 'Top-up' ? 'e.g. 1000' : 'From USSD, the app or the pay station'}
                    autoFocus
                  />
                </div>
                <div>
                  <Label>Date &amp; time *</Label>
                  <input type="datetime-local" className={inputClass} value={entryForm.occurredAt} onChange={(e) => setEntryForm({ ...entryForm, occurredAt: e.target.value })} />
                </div>
              </div>
              {entryForm.kind === 'Parking' && (
                <>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <Label>Vehicle</Label>
                      <select className={inputClass} value={entryForm.vehicleId} onChange={(e) => setEntryForm({ ...entryForm, vehicleId: e.target.value })}>
                        <option value="">—</option>
                        {vehicles.map((v) => (
                          <option key={v.id} value={String(v.id)}>
                            {v.registration}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label>Where</Label>
                      <input className={inputClass} value={entryForm.location} onChange={(e) => setEntryForm({ ...entryForm, location: e.target.value })} placeholder="e.g. JKIA, Westgate, Village Market" />
                    </div>
                  </div>
                  <div>
                    <Label>Trip or task</Label>
                    <input className={inputClass} value={entryForm.reference} onChange={(e) => setEntryForm({ ...entryForm, reference: e.target.value })} placeholder="e.g. MCF-KEN-NOV-2833" />
                  </div>
                </>
              )}
              {entryForm.kind === 'Balance check' && selected && !editingEntry && (
                <p className="-mt-2 text-xs text-gray-400">
                  The platform has {formatKes(selected.balance)}. The difference is recorded so the card reads what it showed.
                </p>
              )}
              <div>
                <Label>Notes</Label>
                <input className={inputClass} value={entryForm.notes} onChange={(e) => setEntryForm({ ...entryForm, notes: e.target.value })} placeholder="Optional" />
              </div>
            </>
          )}
        </FleetModal>
      )}
    </div>
  );
}
