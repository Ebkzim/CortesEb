'use client';

import { ImagePlus, Plus, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { AppLink as Link } from '@/components/navigation';
import { useEffect, useState } from 'react';
import { api, patch, upload } from '@/lib/api';
import type { AccountView } from '@/lib/types';
import { ImageDrop } from './image-drop';
import { useToast } from './toast';
import { Button, EASE } from './ui';

export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

export function Avatar({
  account,
  stamp,
  size = 44,
}: {
  account: AccountView;
  stamp?: number;
  size?: number;
}) {
  const initials = (account.name ?? account.id).replace(/^@/, '').slice(0, 2).toUpperCase();
  return (
    <span className="avatar" style={{ width: size, height: size }}>
      {account.logo !== null ? (
        <img src={`/api/accounts/${account.id}/logo?v=${String(stamp ?? 0)}`} alt="" />
      ) : (
        <span className="avatar__initials">{initials}</span>
      )}
    </span>
  );
}

export function Profiles() {
  const toast = useToast();
  const [accounts, setAccounts] = useState<AccountView[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [logo, setLogo] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [stamp, setStamp] = useState(0);

  useEffect(() => {
    void api<AccountView[]>('/accounts')
      .then(setAccounts)
      .catch(() => {
        setAccounts([]);
      });
  }, []);

  async function save(): Promise<void> {
    const id = slugify(name);
    if (id === '') return;
    setSaving(true);
    try {
      let account = await patch<AccountView>(`/accounts/${id}`, { name: name.trim() });
      if (logo !== null)
        account = await upload<AccountView>(`/accounts/${id}/logo`, logo, () => undefined);
      setAccounts((current) => [
        ...(current ?? []).filter((item) => item.id !== account.id),
        account,
      ]);
      setStamp(Date.now());
      setName('');
      setLogo(null);
      setCreating(false);
      toast('Perfil criado.');
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'não consegui criar o perfil');
    } finally {
      setSaving(false);
    }
  }

  async function changeLogo(account: AccountView, file: File): Promise<void> {
    try {
      const saved = await upload<AccountView>(
        `/accounts/${account.id}/logo`,
        file,
        () => undefined,
      );
      setAccounts((current) =>
        (current ?? []).map((item) => (item.id === saved.id ? saved : item)),
      );
      setStamp(Date.now());
      toast('Logo atualizada.');
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'não consegui enviar a logo');
    }
  }

  return (
    <div className="profiles">
      <div className="spread">
        <h2 className="title-md">Perfis</h2>
        <Link href="/contas/" className="link-arrow">
          gerenciar
        </Link>
      </div>
      <div className="profiles__list">
        <AnimatePresence initial={false}>
          {(accounts ?? []).map((account, index) => (
            <motion.div
              key={account.id}
              className="profile"
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ delay: index * 0.04, duration: 0.4, ease: EASE }}
            >
              <ImageDrop
                className="profile__drop"
                title="Trocar a logo: clique ou arraste uma imagem"
                onFile={(file) => {
                  void changeLogo(account, file);
                }}
              >
                <Avatar account={account} stamp={stamp} />
              </ImageDrop>
              <span className="profile__name">{account.name ?? account.id}</span>
              {account.isDefault && <span className="profile__badge">padrão</span>}
            </motion.div>
          ))}
        </AnimatePresence>
        <motion.button
          type="button"
          className="profile profile--new"
          layout
          whileHover={{ y: -2 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => {
            setCreating((value) => !value);
          }}
          aria-expanded={creating}
        >
          <span className="avatar avatar--new">
            {creating ? <X size={18} /> : <Plus size={18} />}
          </span>
          <span className="profile__name">{creating ? 'Fechar' : 'Novo perfil'}</span>
        </motion.button>
      </div>
      <AnimatePresence>
        {creating && (
          <motion.div
            className="profiles__form"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.45, ease: EASE }}
          >
            <div className="profiles__fields">
              <ImageDrop
                className="profile__logo"
                title="Logo (opcional): clique ou arraste uma imagem"
                onFile={setLogo}
              >
                {logo !== null ? (
                  <img src={URL.createObjectURL(logo)} alt="" />
                ) : (
                  <ImagePlus size={18} />
                )}
              </ImageDrop>
              <input
                className="input"
                placeholder="Nome na marca d’água, ex.: @meucanal"
                maxLength={40}
                value={name}
                autoFocus
                onChange={(event) => {
                  setName(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void save();
                }}
              />
              <Button
                size="small"
                disabled={saving || slugify(name) === ''}
                onClick={() => {
                  void save();
                }}
              >
                {saving ? 'Criando…' : 'Criar'}
              </Button>
            </div>
            <span className="field__hint">A logo é opcional. Clique no círculo para escolher.</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
