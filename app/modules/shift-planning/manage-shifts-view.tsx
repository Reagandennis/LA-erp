'use client';

import { useState } from 'react';

import {
  Avatar,
  colourOf,
  formatHours,
  WEEKDAY_LABELS,
  type Person,
  type ShiftTemplate,
  type Team,
} from './planning-shared';

/**
 * Shift patterns as columns: "Morning 9am–5pm", with the people and teams who
 * work it.
 *
 * A pattern is what a manager maintains; the board shows the individual shifts
 * that result. Editing a pattern never rewrites shifts already worked.
 */

export default function ManageShiftsView({
  templates,
  people,
  teams,
  canManage,
  onCreate,
  onUpdate,
  onDelete,
  onAddMember,
  onRemoveMember,
  onAddTeam,
  onRemoveTeam,
}: {
  templates: ShiftTemplate[];
  people: Person[];
  teams: Team[];
  canManage: boolean;
  onCreate: () => void;
  onUpdate: (id: string, patch: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
  onAddMember: (templateId: string, userId: number) => void;
  onRemoveMember: (templateId: string, userId: number) => void;
  onAddTeam: (templateId: string, teamId: string) => void;
  onRemoveTeam: (templateId: string, teamId: string) => void;
}) {
  const [picking, setPicking] = useState<{ templateId: string; kind: 'person' | 'team' } | null>(null);

  if (templates.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-8">
        <div className="max-w-sm text-center">
          <p className="text-sm font-semibold text-gray-700">No shift patterns yet</p>
          <p className="mt-1 text-xs text-gray-500">
            A pattern is a recurring shift — “Morning, 9am–5pm, Mon–Fri”. Create one, then attach the
            people and teams who work it.
          </p>
          {canManage && (
            <button
              type="button"
              onClick={onCreate}
              className="mt-4 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
            >
              Create shift
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
      <div className="flex gap-4">
        {templates.map((template) => {
          const tone = colourOf(template.colour);
          const availablePeople = people.filter(
            (p) => !template.members.some((m) => m.userId === p.id),
          );
          const availableTeams = teams.filter(
            (t) => !template.teams.some((tt) => tt.teamId === t.id),
          );

          return (
            <section
              key={template.id}
              className="flex w-72 shrink-0 flex-col rounded-2xl border border-gray-100 bg-white shadow-sm"
            >
              <header className="border-b border-gray-100 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-bold text-gray-900">{template.name}</h3>
                    <p className="text-xs text-gray-500">
                      {template.startTime} – {template.endTime} · {formatHours(template.spanHours)}
                    </p>
                  </div>
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${tone.dot}`} />
                </div>

                <div className="mt-2.5 flex flex-wrap gap-1">
                  {WEEKDAY_LABELS.map((label, index) => {
                    const iso = index + 1;
                    const on = template.weekdays.includes(iso);
                    return (
                      <button
                        key={label}
                        type="button"
                        disabled={!canManage}
                        onClick={() =>
                          onUpdate(template.id, {
                            weekdays: on
                              ? template.weekdays.filter((d) => d !== iso)
                              : [...template.weekdays, iso],
                          })
                        }
                        className={`h-6 w-8 rounded-md text-[10px] font-bold uppercase transition ${
                          on ? `${tone.chip}` : 'bg-gray-50 text-gray-300'
                        } ${canManage ? 'hover:opacity-80' : 'cursor-default'}`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </header>

              <div className="flex-1 space-y-4 p-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">People</p>
                  <ul className="mt-2 space-y-1.5">
                    {template.members.map((member) => (
                      <li
                        key={member.userId}
                        className="group flex items-center gap-2 rounded-xl bg-gray-50 px-2 py-1.5"
                      >
                        <Avatar name={member.name} size="sm" />
                        <span className="min-w-0 flex-1 truncate text-xs font-medium text-gray-800">
                          {member.name}
                        </span>
                        <span className="text-[10px] text-gray-400">
                          {formatHours(member.hours ?? template.spanHours)}
                        </span>
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => onRemoveMember(template.id, member.userId)}
                            aria-label={`Remove ${member.name}`}
                            className="rounded p-0.5 text-gray-300 opacity-0 transition hover:text-rose-600 group-hover:opacity-100"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        )}
                      </li>
                    ))}
                    {template.members.length === 0 && (
                      <li className="px-2 text-[11px] text-gray-400">Nobody assigned yet.</li>
                    )}
                  </ul>
                  {canManage && (
                    <AddPicker
                      open={picking?.templateId === template.id && picking.kind === 'person'}
                      label="+ Add person"
                      emptyLabel="Everyone is already on this shift."
                      options={availablePeople.map((p) => ({
                        value: String(p.id),
                        label: `${p.name} · ${p.position}`,
                      }))}
                      onOpen={() => setPicking({ templateId: template.id, kind: 'person' })}
                      onClose={() => setPicking(null)}
                      onPick={(value) => {
                        onAddMember(template.id, Number(value));
                        setPicking(null);
                      }}
                    />
                  )}
                </div>

                <div className="border-t border-gray-100 pt-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Teams</p>
                  <ul className="mt-2 space-y-1.5">
                    {template.teams.map((team) => {
                      const teamTone = colourOf(team.colour);
                      return (
                        <li
                          key={team.teamId}
                          className="group flex items-center gap-2 rounded-xl bg-gray-50 px-2 py-1.5"
                        >
                          <span
                            className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${teamTone.chip}`}
                          >
                            {team.name.slice(0, 1).toUpperCase()}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-xs font-medium text-gray-800">
                            {team.name}
                          </span>
                          <span className="text-[10px] text-gray-400">{team.memberCount} ppl</span>
                          {canManage && (
                            <button
                              type="button"
                              onClick={() => onRemoveTeam(template.id, team.teamId)}
                              aria-label={`Remove ${team.name}`}
                              className="rounded p-0.5 text-gray-300 opacity-0 transition hover:text-rose-600 group-hover:opacity-100"
                            >
                              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          )}
                        </li>
                      );
                    })}
                    {template.teams.length === 0 && (
                      <li className="px-2 text-[11px] text-gray-400">No teams on this shift.</li>
                    )}
                  </ul>
                  {canManage && (
                    <AddPicker
                      open={picking?.templateId === template.id && picking.kind === 'team'}
                      label="+ Add team"
                      emptyLabel={teams.length === 0 ? 'Create a team first.' : 'All teams are on this shift.'}
                      options={availableTeams.map((t) => ({ value: t.id, label: t.name }))}
                      onOpen={() => setPicking({ templateId: template.id, kind: 'team' })}
                      onClose={() => setPicking(null)}
                      onPick={(value) => {
                        onAddTeam(template.id, value);
                        setPicking(null);
                      }}
                    />
                  )}
                </div>
              </div>

              {canManage && (
                <footer className="border-t border-gray-100 p-3">
                  <button
                    type="button"
                    onClick={() => onDelete(template.id)}
                    className="w-full rounded-xl px-3 py-1.5 text-xs font-medium text-rose-600 transition hover:bg-rose-50"
                  >
                    Delete pattern
                  </button>
                </footer>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** A compact "+ Add …" control that expands into a select. */
function AddPicker({
  open,
  label,
  emptyLabel,
  options,
  onOpen,
  onClose,
  onPick,
}: {
  open: boolean;
  label: string;
  emptyLabel: string;
  options: Array<{ value: string; label: string }>;
  onOpen: () => void;
  onClose: () => void;
  onPick: (value: string) => void;
}) {
  if (!open) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="mt-2 w-full rounded-xl border border-dashed border-gray-200 py-1.5 text-[11px] font-medium text-gray-400 transition hover:border-primary/40 hover:text-primary"
      >
        {label}
      </button>
    );
  }

  if (options.length === 0) {
    return (
      <div className="mt-2 space-y-1.5">
        <p className="px-1 text-[11px] text-gray-400">{emptyLabel}</p>
        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-xl bg-gray-50 py-1.5 text-[11px] text-gray-600 transition hover:bg-gray-100"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-1.5">
      <select
        autoFocus
        defaultValue=""
        onChange={(e) => e.target.value && onPick(e.target.value)}
        className="w-full rounded-xl bg-gray-50 px-2.5 py-2 text-xs text-gray-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
      >
        <option value="" disabled>
          Choose…
        </option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={onClose}
        className="w-full rounded-xl bg-gray-50 py-1.5 text-[11px] text-gray-600 transition hover:bg-gray-100"
      >
        Cancel
      </button>
    </div>
  );
}
