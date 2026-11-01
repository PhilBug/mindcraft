# Instrukcja: bot Mindcraft przez ViaProxy (krok po kroku)

Konfiguracja dla nicku **philbug** — dołączanie do serwera `26.3` botem o protokole `1.21.6`
przez lokalne ViaProxy, logowanie kontem Microsoft. Niczego nie instalujemy na serwerze.

> Pełna dokumentacja launchera: [LAUNCHER.pl.md](LAUNCHER.pl.md)

---

## Krok 0 — wymagania

- Java 17+ (`java -version`) — do ViaProxy
- Node.js + `npm install` (zależności Mindcraft) — już zrobione w tym repo
- ViaProxy `v3.4.14` w `.local/viaproxy/ViaProxy.jar` — już pobrane (`npm run bot:setup -- --download` w razie czego)
- Klucz do modelu LLM (z.ai GLM — patrz niżej, albo inny provider)

## Krok 1 — `launcher.config.json` (adres serwera, nick, wersje)

Plik jest gitignored (Twój prywatny). Uzupełnij sekcję `server` — reszta jest gotowa:

```jsonc
{
    "server": {
        "host": "adres.twojego.serwera",   // ← adres lub IP Twojego serwera
        "port": 25565,                     // ← port (25565 = domyślny)
        "version": "26.3"                  // ← wersja, na jakiej działa serwer
    },
    "account": {
        "username": "philbug",             // ← DOKŁADNIE nick w grze konta Microsoft
        "auth": "microsoft",
        "accountIndex": 0                  // indeks konta na liście ViaProxy (pierwsze = 0)
    },
    "proxy":   { "bindHost": "127.0.0.1", "bindPort": 25568, "...": "reszta bez zmian" },
    "mindcraft": { "clientVersion": "1.21.6", "profilePath": "./philbug.json" }
}
```

**Ważne:** `account.username` to nick z Minecrafta (**nie e-mail**). Jeśli konto Microsoft,
którym się logujesz, ma w grze nazwę `philbug` — wszystko się zgadza. Jeśli się różni, launcher
ostrzeże, a bot wejdzie na serwer pod nazwą z konta.

## Krok 2 — klucz API modelu (z.ai GLM Coding Plan)

Bot używa profilu `philbug.json` (GLM przez z.ai). Klucz wstaw do `keys.json`:

```bash
cp keys.example.json keys.json
# w keys.json ustaw pole DEEPSEEK_API_KEY na swój klucz Z.AI:
#   "DEEPSEEK_API_KEY": "twoj-klucz-zai.xxxx"
```

> Mindcraft nie ma dedykowanego providera z.ai, ale jego klasa `deepseek` to uniwersalny
> klient OpenAI-compatible — profil `philbug.json` kieruje go na endpoint z.ai.

## Krok 3 — sprawdzenie konfiguracji

```bash
npm run bot:doctor
```

Oczekiwane: `Config OK`, `Java`, `ViaProxy jar present`, `Bot profile present`,
`Proxy port 127.0.0.1:25568 is free`. Połączenie z serwerem pokaże `NOT TESTED` —
doctor tego nie testuje (opcjonalny `--probe` sprawdza wyłącznie osiągalność TCP).

## Krok 4 — jednorazowe logowanie Microsoft (serwery online-mode)

```bash
npm run bot:setup -- --login
```

W konsoli, która się otworzy, wpisz:

```
account add microsoft
```

1. ViaProxy wypisze **link i kod** → otwórz link w przeglądarce, zaloguj się kontem
   Microsoft o nicku `philbug`, wpisz kod.
2. `account list` — powinno pokazać `[0] philbug (Microsoft)`.
3. Zakończ **Ctrl+C**. Launcher zweryfikuje konto i zgodność nicka.

*(Serwer offline-mode: ustaw `"auth": "offline"` w configu i pomiń ten krok.)*

## Krok 5 — start

```bash
npm run bot:start
```

- Bot wejdzie na serwer jako **philbug**.
- Wyłączasz **Ctrl+C** (launcher zamyka ViaProxy i Mindcraft).
- Przy kolejnych uruchomieniach krok 4 pomijasz — konto siedzi w
  `.local/runtime/viaproxy/saves.json`.

Oczekiwane, nieszkodliwe komunikaty:
- `[Mindcraft] Error getting server ... version is incorrect` — ViaProxy ogłasza wersję
  serwera (26.3), bot łączy się 1.21.6; tak ma być.
- `Proxy startup timed out` — ViaProxy nie wystartował; zobacz
  `.local/runtime/logs/viaproxy.log`.

## Typowe problemy

| Komunikat | Co robić |
|---|---|
| `API key "DEEPSEEK_API_KEY" not found` | wpisz klucz z.ai do `keys.json` (krok 2) |
| `Java not found` / wersja < 17 | zainstaluj JDK/JRE 17+ lub ustaw `proxy.javaPath` |
| `ViaProxy file not found` | `npm run bot:setup -- --download` |
| `Port ... is already in use` | zabij starą instancję lub zmień `proxy.bindPort` |
| `No Microsoft accounts saved` | `npm run bot:setup -- --login` |
| `Failed to start agent process` | patrz wyżej w logu `[Mindcraft]`; launcher sam zamyka oba procesy |

---

## Aneks: model z.ai (GLM Coding Plan) — jak to działa

Profil `philbug.json` (Twój lokalny plik, gitignored):

```json
{
    "name": "philbug",
    "model": "glm-5.3",
    "api": "deepseek",
    "url": "https://api.z.ai/api/coding/paas/v4"
}
```

- `"api": "deepseek"` wybiera klasę OpenAI-compatible w Mindcraft (`src/models/deepseek.js`),
  `"url"` przekierowuje ją na endpoint z.ai, klucz bierze z `keys.json` (`DEEPSEEK_API_KEY`).
- Endpoint **musi** być `https://api.z.ai/api/coding/paas/v4` (Coding Plan), **nie**
  `https://api.z.ai/api/paas/v4` (to rozlicza się z salda standardowego API).
- Klucz Coding Plan tworzysz w konsoli Z.AI: **Personal Coding Plan → Plan Overview**
  (klucze Coding Plan i standardowe API są od 2026-10-16 osobne i nie są wymienne).
- Modele wg dokumentacji z.ai: `glm-5.3` (tekstowy) i `glm-5.3-flash` (multimodalny);
  dostępna lista zależy od Twojego planu — sprawdź w konsoli Z.AI i wpisz dokładnie taką nazwę.
- Jeśli wolisz inny model/provider (np. OpenAI), po prostu wróć do `"profilePath": "./andy.json"`
  w `launcher.config.json` i ustaw `OPENAI_API_KEY` w `keys.json`.

**Stan na dziś (co zweryfikowano / czego nie):** endpointy i nazwy modeli pochodzą z
dokumentacji Z.AI (devpack/quick-start, devpack/tool/others, notice/api-key-management).
Rzeczywistego wywołania API z.ai ani wejścia bota na prawdziwy serwer nie testowano —
zrobisz to w krokach 2 i 5.
