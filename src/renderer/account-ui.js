// Konto-Bereich in der Seitenleiste: aktives Konto anzeigen, Menü zum Wechseln, Hinzufügen, Entfernen und Abmelden.
let accountList = [];
let accountMenuOpen = false;
let accountBusy = false;

function accountHue(str) {
  let h = 0;
  for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}
// Lokal gezeichneter Avatar (Anfangsbuchstabe, Farbe aus der UUID) – es wird nichts von fremden Diensten geladen.
function accountAvatar(acc) {
  const node = el('div', { className: 'avatar', textContent: (acc.name || '?').slice(0, 1).toUpperCase() });
  node.style.background = `hsl(${accountHue(acc.uuid || acc.name || '')} 55% 45%)`;
  return node;
}
function gameRunning() {
  return state.busy.size > 0 || state.instances.some((i) => i.running);
}
const GAME_RUNNING_HINT = 'Solange ein Spiel läuft oder startet, kann das Konto nicht gewechselt werden.';

function closeAccountMenu() {
  if (!accountMenuOpen) return;
  accountMenuOpen = false;
  renderAccount();
}
// Eine Kontoaktion ausführen und danach den Bereich neu laden; während eines laufenden Spiels gesperrt.
async function accountAction(channel, ...args) {
  if (accountBusy) return;
  if (gameRunning()) return toast(GAME_RUNNING_HINT);
  accountBusy = true;
  accountMenuOpen = false;
  renderAccount();
  await run(() => api.call(channel, ...args));
  accountBusy = false;
  await refreshAccount();
}

function accountMenu(active) {
  const locked = gameRunning();
  const menu = el('div', { className: 'account-menu', id: 'account-menu' });
  menu.setAttribute('role', 'menu');
  const others = accountList.filter((a) => !a.active);
  if (others.length) {
    menu.append(el('div', { className: 'account-menu-title', textContent: 'Konto wechseln' }));
    const list = el('div', { className: 'account-menu-list' });
    for (const acc of others) {
      const pick = el('button', { className: 'account-item', title: `Zu ${acc.name} wechseln`, disabled: locked },
        accountAvatar(acc), el('span', { textContent: acc.name }));
      pick.setAttribute('role', 'menuitem');
      pick.onclick = () => accountAction('account:switch', acc.uuid);
      const remove = el('button', { className: 'account-remove', textContent: '×', title: `${acc.name} entfernen`, disabled: locked });
      remove.setAttribute('aria-label', `${acc.name} entfernen`);
      remove.onclick = (e) => {
        e.stopPropagation();
        // Zweiter Klick bestätigt: das Konto müsste sonst neu angemeldet werden.
        if (!remove.classList.contains('confirm')) {
          remove.classList.add('confirm');
          remove.textContent = 'Entfernen?';
          return;
        }
        accountAction('account:remove', acc.uuid);
      };
      list.append(el('div', { className: 'account-row' }, pick, remove));
    }
    menu.append(list);
  }
  const add = el('button', { className: 'account-item', textContent: '+ Konto hinzufügen', disabled: locked });
  add.setAttribute('role', 'menuitem');
  add.onclick = () => accountAction('account:login');
  const out = el('button', { className: 'account-item danger', textContent: `${active.name} abmelden`, disabled: locked });
  out.setAttribute('role', 'menuitem');
  out.onclick = () => accountAction('account:logout');
  menu.append(add, out);
  if (locked) menu.append(el('div', { className: 'account-menu-hint', textContent: GAME_RUNNING_HINT }));
  return menu;
}

function renderAccount() {
  const box = $('#account');
  if (!box) return;
  box.replaceChildren();
  const active = state.account;
  if (!active) {
    accountMenuOpen = false;
    box.append(el('button', {
      className: 'btn primary',
      textContent: accountBusy ? 'Anmeldung läuft ...' : 'Mit Microsoft anmelden',
      disabled: accountBusy,
      onclick: () => accountAction('account:login'),
    }));
    return;
  }
  const count = accountList.length;
  const trigger = el('button', { className: 'account-btn', id: 'account-btn', disabled: accountBusy, title: 'Konten verwalten' },
    accountAvatar(active),
    el('span', { className: 'account-name' },
      el('span', { className: 'account-name-main', textContent: active.name }),
      el('span', { className: 'account-name-sub', textContent: accountBusy ? 'Bitte warten ...' : count > 1 ? `${count} Konten` : 'Microsoft-Konto' })),
    el('span', { className: 'account-chevron', textContent: accountMenuOpen ? '▾' : '▴' }));
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', String(accountMenuOpen));
  trigger.onclick = (e) => {
    e.stopPropagation();
    accountMenuOpen = !accountMenuOpen;
    renderAccount();
  };
  if (accountMenuOpen) box.append(accountMenu(active));
  box.append(trigger);
}

async function refreshAccount() {
  let list = await run(() => api.call('account:list'));
  if (!Array.isArray(list)) list = [];
  accountList = list.filter((a) => a && typeof a.name === 'string' && typeof a.uuid === 'string');
  const active = accountList.find((a) => a.active) || null;
  state.account = active ? { name: active.name, uuid: active.uuid } : null;
  renderAccount();
}

// Menü schließen: Klick daneben oder Escape.
document.addEventListener('click', (e) => {
  if (accountMenuOpen && !(e.target instanceof Node && $('#account').contains(e.target))) closeAccountMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeAccountMenu();
});
