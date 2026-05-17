function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

async function loadThemePreference() {
  try {
    const result = await browser.storage.local.get('theme');
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
    await browser.storage.local.set({ theme });
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
