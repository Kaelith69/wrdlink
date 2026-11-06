import { useTheme } from './useTheme';

export function ThemeToggle() {
  const [theme, toggleTheme] = useTheme();
  const nextTheme = theme === 'light' ? 'dark' : 'light';
  return (
    <button
      className="theme-toggle"
      type="button"
      onClick={toggleTheme}
      aria-label={`Switch to ${nextTheme} mode`}
      title={`Switch to ${nextTheme} mode`}
    >
      <span aria-hidden="true">{theme === 'light' ? '☾' : '☀'}</span>
    </button>
  );
}
