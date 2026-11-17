'use client';

import { ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { post } from '@/lib/api';
import type { ApiKeyView } from '@/lib/types';
import { Button, Segmented } from './ui';

type Provider = ApiKeyView['provider'];

const MODEL_HINT: Record<Provider, string> = {
  anthropic: 'opcional (padrão: claude-sonnet-5-5)',
  openai: 'o nome do modelo na sua conta OpenAI',
  compatible: 'o nome do modelo no servidor',
};

export function KeyForm({
  onSaved,
  onCancel,
}: {
  onSaved: (key: ApiKeyView) => void;
  onCancel?: () => void;
}) {
  const [provider, setProvider] = useState<Provider>('anthropic');
  const [label, setLabel] = useState('');
  const [secret, setSecret] = useState('');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      const key = await post<ApiKeyView>('/keys', {
        provider,
        label: label.trim() === '' ? providerName(provider) : label.trim(),
        secret: secret.trim(),
        ...(model.trim() === '' ? {} : { model: model.trim() }),
        ...(provider === 'compatible' && baseUrl.trim() !== '' ? { baseUrl: baseUrl.trim() } : {}),
      });
      setSecret('');
      onSaved(key);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'não consegui guardar a chave');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="stack">
      <Segmented
        id="provider"
        value={provider}
        options={[
          { value: 'anthropic', label: 'Claude' },
          { value: 'openai', label: 'OpenAI' },
          { value: 'compatible', label: 'Outro compatível' },
        ]}
        onChange={setProvider}
      />
      <div className="grid grid--2">
        <label className="field">
          <span className="field__label">Nome</span>
          <input
            className="input"
            placeholder={providerName(provider)}
            value={label}
            maxLength={80}
            onChange={(event) => {
              setLabel(event.target.value);
            }}
          />
        </label>
        <label className="field">
          <span className="field__label">Modelo</span>
          <input
            className="input"
            placeholder={MODEL_HINT[provider]}
            value={model}
            maxLength={100}
            onChange={(event) => {
              setModel(event.target.value);
            }}
          />
        </label>
      </div>
      {provider === 'compatible' && (
        <label className="field">
          <span className="field__label">Endereço do servidor</span>
          <input
            className="input"
            placeholder="https://servidor/v1"
            value={baseUrl}
            onChange={(event) => {
              setBaseUrl(event.target.value);
            }}
          />
        </label>
      )}
      <label className="field">
        <span className="field__label">Chave</span>
        <input
          className="input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={secret}
          onChange={(event) => {
            setSecret(event.target.value);
          }}
        />
        <span className="field__hint row" style={{ gap: 6 }}>
          <ShieldCheck size={14} /> Guardada com criptografia. Depois de salva, ela nunca mais
          aparece na tela.
        </span>
      </label>
      {error !== null && <p className="small">{error}</p>}
      <div className="row">
        <Button
          size="small"
          disabled={saving || secret.trim().length < 8}
          onClick={() => {
            void save();
          }}
        >
          {saving ? 'Guardando…' : 'Guardar chave'}
        </Button>
        {onCancel !== undefined && (
          <Button variant="ghost" size="small" onClick={onCancel}>
            Cancelar
          </Button>
        )}
      </div>
    </div>
  );
}

function providerName(provider: Provider): string {
  return provider === 'anthropic'
    ? 'Claude'
    : provider === 'openai'
      ? 'OpenAI'
      : 'Servidor compatível';
}
