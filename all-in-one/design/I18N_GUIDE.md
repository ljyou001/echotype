# Internationalization (i18n) Guide

## Overview

Echotype uses `react-i18next` for internationalization support. The application is currently available in:
- **English (en)** - Default language
- **Chinese (zh)** - 中文支持

## Architecture

### File Structure
```
frontend/src/i18n/
  config.ts           # i18n initialization
  locales/
    en.json          # English translations
    zh.json          # Chinese translations
```

### Configuration

The i18n system is initialized in `src/i18n/config.ts`:

```typescript
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import zh from "./locales/zh.json";

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    zh: { translation: zh }
  },
  lng: "en", // Default language
  fallbackLng: "en",
  interpolation: {
    escapeValue: false
  }
});
```

## Usage in Components

### Basic Usage

```typescript
import { useTranslation } from "react-i18next";

function MyComponent() {
  const { t } = useTranslation();
  
  return (
    <div>
      <h1>{t("nav.home")}</h1>
      <p>{t("home.statusMessage.ready")}</p>
    </div>
  );
}
```

### With Variables

```typescript
// In translation file:
{
  "welcome": "Welcome, {{name}}!"
}

// In component:
<p>{t("welcome", { name: "User" })}</p>
```

### Pluralization

```typescript
// In translation file:
{
  "items": "{{count}} item",
  "items_plural": "{{count}} items"
}

// In component:
<p>{t("items", { count: 5 })}</p>
```

## Translation Keys Structure

### Navigation
- `nav.home` - Home
- `nav.history` - History
- `nav.models` - Models
- `nav.integrations` - Integrations
- `nav.settings` - Settings

### Status
- `status.loading` - Loading
- `status.ready` - Ready
- `status.recording` - Recording
- `status.error` - Error
- `status.offline` - Offline
- `status.connected` - Connected
- `status.disconnected` - Disconnected

### Home Page
- `home.statusMessage.*` - Status messages
- `home.cards.*` - Card labels
- `home.modes.*` - Mode labels
- `home.error.*` - Error messages
- `home.transcript.*` - Transcript labels

### Models Page
- `models.title` - Page title
- `models.description` - Page description
- `models.status.*` - Model status labels
- `models.info.*` - Model information labels
- `models.settings.*` - Model settings labels

### History Page
- `history.title` - Page title
- `history.description` - Page description
- `history.empty` - Empty state message
- `history.actions.*` - Action button labels

### Settings Page
- `settings.title` - Page title
- `settings.description` - Page description
- `settings.startup.*` - Startup settings
- `settings.hotkey.*` - Hotkey settings
- `settings.audio.*` - Audio settings
- `settings.output.*` - Output settings
- `settings.textProcessing.*` - Text processing settings
- `settings.streaming.*` - Streaming settings

### Errors
- `errors.model.*` - Model-related errors
- `errors.device.*` - Device-related errors
- `errors.performance.*` - Performance errors
- `errors.dependency.*` - Dependency errors
- `errors.restart.*` - Restart-related errors
- `errors.connection.*` - Connection errors
- `errors.websocket.*` - WebSocket errors
- `errors.unknown.*` - Unknown errors

## Adding a New Language

1. Create a new translation file in `src/i18n/locales/`:
   ```
   src/i18n/locales/ja.json  # Japanese
   ```

2. Copy the structure from `en.json` and translate all values:
   ```json
   {
     "app": {
       "name": "Echotype",
       "subtitle": "オールインワン"
     },
     "nav": {
       "home": "ホーム",
       ...
     }
   }
   ```

3. Import and register in `src/i18n/config.ts`:
   ```typescript
   import ja from "./locales/ja.json";
   
   i18n.use(initReactI18next).init({
     resources: {
       en: { translation: en },
       zh: { translation: zh },
       ja: { translation: ja }  // Add new language
     },
     ...
   });
   ```

4. Add language switcher in Settings page (future enhancement).

## Language Switching

To change the language programmatically:

```typescript
import { useTranslation } from "react-i18next";

function LanguageSwitcher() {
  const { i18n } = useTranslation();
  
  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng);
  };
  
  return (
    <select onChange={(e) => changeLanguage(e.target.value)} value={i18n.language}>
      <option value="en">English</option>
      <option value="zh">中文</option>
    </select>
  );
}
```

## Best Practices

1. **Always use translation keys**: Never hardcode text in components.
   ```typescript
   // ❌ Bad
   <h1>Home</h1>
   
   // ✅ Good
   <h1>{t("nav.home")}</h1>
   ```

2. **Use descriptive keys**: Keys should indicate where and what they're used for.
   ```typescript
   // ❌ Bad
   "text1": "Click here"
   
   // ✅ Good
   "home.cards.model": "Model"
   ```

3. **Keep translations consistent**: Use the same terminology across the app.

4. **Provide fallbacks**: Always have English as the fallback language.

5. **Test all languages**: Ensure UI doesn't break with longer translations.

6. **Use namespaces for large apps**: For better organization (future enhancement).

## Current Status

- ✅ English (en) - Complete
- ✅ Chinese (zh) - Complete
- ⏳ Language switcher UI - Planned
- ⏳ Persistent language preference - Planned
- ⏳ Additional languages - Planned

## Future Enhancements

1. **Language Switcher**: Add UI in Settings page to change language.
2. **Persistent Storage**: Save user's language preference to localStorage.
3. **Auto-detection**: Detect system language on first launch.
4. **RTL Support**: Add support for right-to-left languages (Arabic, Hebrew).
5. **Lazy Loading**: Load translation files on demand for better performance.
6. **Translation Management**: Use a translation management platform (e.g., Crowdin, Lokalise).

## Testing

To test translations:

1. Change the default language in `src/i18n/config.ts`:
   ```typescript
   lng: "zh", // Test Chinese
   ```

2. Or use browser console:
   ```javascript
   window.i18n.changeLanguage('zh');
   ```

3. Verify all text is translated and UI layout is correct.

## Resources

- [react-i18next Documentation](https://react.i18next.com/)
- [i18next Documentation](https://www.i18next.com/)
- [ICU Message Format](https://unicode-org.github.io/icu/userguide/format_parse/messages/)
