export const STORAGE_KEY = 'cortes-theme';
export const DARK_QUERY = '(prefers-color-scheme: dark)';

export const THEME_SCRIPT = `(function(){var d=document.documentElement;try{var t=localStorage.getItem('${STORAGE_KEY}');var dark=t==='dark'||(t!=='light'&&matchMedia('${DARK_QUERY}').matches);d.dataset.theme=dark?'dark':'light'}catch(e){d.dataset.theme='light'}})()`;
