// Konto-Bereich in der Seitenleiste (anmelden / abmelden).
async function refreshAccount() {
  state.account = await run(() => api.call('account:get'));
  const box = $('#account');
  box.replaceChildren();
  if (state.account) {
    box.append(
      el('div', { className: 'who' },
        el('div', { className: 'avatar', textContent: state.account.name[0].toUpperCase() }),
        el('span', { textContent: state.account.name })),
      el('button', {
        className: 'btn small',
        textContent: 'Abmelden',
        onclick: async () => { await run(() => api.call('account:logout')); refreshAccount(); },
      })
    );
  } else {
    box.append(el('button', {
      className: 'btn primary',
      textContent: 'Mit Microsoft anmelden',
      onclick: async (e) => {
        e.target.disabled = true;
        await run(() => api.call('account:login'));
        refreshAccount();
      },
    }));
  }
}
