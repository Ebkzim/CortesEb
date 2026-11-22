'use client';

import { useEffect, useState } from 'react';

export interface TimeRange {
  minSeconds: number;
  maxSeconds: number;
}
export function TimingField({
  label,
  value,
  range,
  min,
  max,
  disabled,
  onChange,
  alwaysRandom = false,
}: {
  label: string;
  value: number;
  range: TimeRange | null;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (value: number, range: TimeRange | null) => void;
  alwaysRandom?: boolean;
}) {
  return (
    <fieldset className="timing-field" disabled={disabled}>
      <legend>{label}</legend>
      {!alwaysRandom && (
        <div className="timing-field__mode" role="group" aria-label={`Modo: ${label}`}>
          <button type="button" aria-pressed={!range} onClick={() => onChange(value, null)}>
            Fixo
          </button>
          <button
            type="button"
            aria-pressed={!!range}
            onClick={() =>
              onChange(value, {
                minSeconds: Math.max(min, Math.min(value, 10)),
                maxSeconds: Math.max(min, Math.min(max, value)),
              })
            }
          >
            Variável
          </button>
        </div>
      )}
      {range ? (
        <div className="timing-field__range">
          <label>
            <span>Mínimo</span>
            <div className="warming-unit">
              <TimeInput
                className="input"
                type="number"
                min={min}
                max={max}
                value={range.minSeconds}
                aria-label={`${label}: mínimo em segundos`}
                onValue={(n) => {
                  onChange(value, { minSeconds: n, maxSeconds: Math.max(n, range.maxSeconds) });
                }}
              />
              <span>s</span>
            </div>
          </label>
          <span className="timing-field__to">a</span>
          <label>
            <span>Máximo</span>
            <div className="warming-unit">
              <TimeInput
                className="input"
                type="number"
                min={min}
                max={max}
                value={range.maxSeconds}
                aria-label={`${label}: máximo em segundos`}
                onValue={(n) => {
                  onChange(value, { minSeconds: Math.min(n, range.minSeconds), maxSeconds: n });
                }}
              />
              <span>s</span>
            </div>
          </label>
        </div>
      ) : (
        <div className="warming-unit">
          <TimeInput
            className="input"
            type="number"
            aria-label={`${label} em segundos`}
            min={min}
            max={max}
            value={value}
            onValue={(n) => onChange(n, null)}
          />
          <span>segundos</span>
        </div>
      )}
      <small>
        {range
          ? range.minSeconds === range.maxSeconds
            ? 'Com limites iguais, o tempo fica fixo.'
            : 'Um novo tempo é sorteado a cada ciclo.'
          : 'O mesmo tempo em todos os ciclos.'}
      </small>
    </fieldset>
  );
}

function TimeInput({
  value,
  min,
  max,
  onValue,
  ...props
}: {
  value: number;
  min: number;
  max: number;
  onValue: (n: number) => void;
  className: string;
  type: string;
  'aria-label': string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <input
      {...props}
      min={min}
      max={max}
      step={1}
      value={text}
      onChange={(event) => {
        const raw = event.target.value;
        setText(raw);
        const n = Number(raw);
        if (raw !== '' && Number.isInteger(n) && n >= min && n <= max) onValue(n);
      }}
      onBlur={() => {
        const n = Math.min(max, Math.max(min, Math.round(Number(text)) || min));
        setText(String(n));
        onValue(n);
      }}
    />
  );
}
