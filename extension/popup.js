// ----- Theme -----
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

async function loadThemePreference() {
  try {
    const result = await TabMarginStorage.get('theme');
    const theme = result.theme || 'system';
    applyTheme(theme);
    const radio = document.querySelector(`input[value="${theme}"]`);
    if (radio) radio.checked = true;
  } catch (error) {
    console.error('Error loading theme preference:', error);
  }
}

async function saveThemePreference(theme) {
  try {
    await TabMarginStorage.set({ theme });
    applyTheme(theme);
  } catch (error) {
    console.error('Error saving theme preference:', error);
  }
}

document.querySelectorAll('input[name="theme"]').forEach(radio => {
  radio.addEventListener('change', (e) => {
    saveThemePreference(e.target.value);
  });
});

loadThemePreference();

// ----- Account -----
const signedOutView = document.getElementById('signedOutView');
const signedInView = document.getElementById('signedInView');
const authForm = document.getElementById('authForm');
const emailInput = document.getElementById('emailInput');
const passwordInput = document.getElementById('passwordInput');
const signInBtn = document.getElementById('signInBtn');
const signUpBtn = document.getElementById('signUpBtn');
const forgotBtn = document.getElementById('forgotBtn');
const signOutBtn = document.getElementById('signOutBtn');
const accountEmail = document.getElementById('accountEmail');
const authMessage = document.getElementById('authMessage');
const planBadge = document.getElementById('planBadge');
const freeView = document.getElementById('freeView');
const proView = document.getElementById('proView');
const proMeta = document.getElementById('proMeta');
const upgradeBtn = document.getElementById('upgradeBtn');
const manageBtn = document.getElementById('manageBtn');

function showMessage(text, isError = false) {
  authMessage.textContent = text;
  authMessage.classList.toggle('error', isError);
  authMessage.hidden = false;
}

function clearMessage() {
  authMessage.hidden = true;
  authMessage.textContent = '';
}

function setBusy(busy) {
  signInBtn.disabled = busy;
  signUpBtn.disabled = busy;
  forgotBtn.disabled = busy;
  emailInput.disabled = busy;
  passwordInput.disabled = busy;
}

async function renderAccountView() {
  const session = await TabMarginAPI.getSession();
  // Web shell hook: lets app.js gate the editor on sign-in/out. Undefined (no-op)
  // in the extension, where the editor and popup are separate contexts.
  if (typeof window.TabMarginOnAuthChange === 'function') {
    window.TabMarginOnAuthChange(session?.user?.email ? session : null);
  }
  if (!session?.user?.email) {
    signedOutView.hidden = false;
    signedInView.hidden = true;
    return;
  }

  signedOutView.hidden = true;
  signedInView.hidden = false;
  accountEmail.textContent = session.user.email;

  // Optimistic: show Free until /me responds
  applyPlan('free', null);

  try {
    const me = await TabMarginAPI.getMe();
    applyPlan(me.plan, me.subscription);
  } catch (err) {
    console.error('Failed to fetch plan:', err);
  }
}

function applyPlan(plan, subscription) {
  const isPro = plan === 'pro';
  planBadge.textContent = isPro ? 'Pro' : 'Free';
  planBadge.classList.toggle('plan-pro', isPro);

  freeView.hidden = isPro;
  proView.hidden = !isPro;

  if (isPro && subscription?.cancel_at_period_end && subscription.current_period_end) {
    const end = new Date(subscription.current_period_end).toLocaleDateString();
    proMeta.textContent = `Cancels on ${end}`;
  } else if (isPro) {
    proMeta.textContent = 'Cloud sync active';
  }
}

async function openInTab(getUrl, button, busyLabel) {
  const original = button.textContent;
  button.textContent = busyLabel;
  button.disabled = true;
  try {
    const url = await getUrl();
    await TabMarginEnv.openUrl(url);
  } catch (err) {
    console.error(err);
    button.textContent = original;
    button.disabled = false;
    showMessage(err.message || 'Something went wrong', true);
  }
}

upgradeBtn.addEventListener('click', () =>
  openInTab(TabMarginAPI.createCheckoutUrl, upgradeBtn, 'Opening checkout…')
);

manageBtn.addEventListener('click', () =>
  openInTab(TabMarginAPI.createPortalUrl, manageBtn, 'Opening…')
);

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearMessage();
  setBusy(true);
  try {
    await TabMarginAPI.signIn(emailInput.value.trim(), passwordInput.value);
    passwordInput.value = '';
    await renderAccountView();
  } catch (err) {
    showMessage(err.message || 'Sign-in failed', true);
  } finally {
    setBusy(false);
  }
});

signUpBtn.addEventListener('click', async () => {
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  if (!email || !password) {
    showMessage('Enter an email and password to create an account.', true);
    return;
  }
  clearMessage();
  setBusy(true);
  try {
    const { signedIn, needsConfirm } = await TabMarginAPI.signUp(email, password);
    if (signedIn) {
      passwordInput.value = '';
      await renderAccountView();
    } else if (needsConfirm) {
      showMessage('Check your email to confirm your account, then sign in.');
    }
  } catch (err) {
    showMessage(err.message || 'Sign-up failed', true);
  } finally {
    setBusy(false);
  }
});

forgotBtn.addEventListener('click', async () => {
  const email = emailInput.value.trim();
  if (!email) {
    showMessage('Enter your email above, then click Forgot password.', true);
    return;
  }
  clearMessage();
  setBusy(true);
  try {
    await TabMarginAPI.requestPasswordReset(email);
    showMessage('Check your email for a reset link.');
  } catch (err) {
    showMessage(err.message || 'Could not send reset email', true);
  } finally {
    setBusy(false);
  }
});

signOutBtn.addEventListener('click', async () => {
  try {
    await TabMarginAPI.signOut();
    await renderAccountView();
  } catch (err) {
    console.error('Sign out error:', err);
  }
});

TabMarginStorage.onChanged((changes, area) => {
  if (area === 'local' && changes.auth) {
    renderAccountView();
  }
});

// Expose for the web shell (app.js): re-render the account panel after returning
// from Stripe (focus) so the plan badge flips Free→Pro. Unused in the extension.
window.TabMarginAccount = { renderAccountView };

renderAccountView();
