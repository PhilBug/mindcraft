# Launcher Mindcraft + ViaProxy — instrukcja (PL)

Lokalny launcher łączy **ViaProxy** (tłumaczenie wersji protokołu + logowanie kontem Microsoft)
i **Mindcraft** (bot) na podstawie **jednego pliku konfiguracyjnego**: `launcher.config.json`.
Na serwerze Minecraft nie instalujesz niczego.

Cała konfiguracja ViaProxy zostałą zweryfikowana w źródłach **ViaProxy v3.4.14**
(github.com/ViaVersion/ViaProxy, tag `v3.4.14`): nazwy opcji CLI, komendy `account`,
katalog danych (`VP_RUN_DIR`/cwd), wymaganie Java 17+, obsługa wersji serwera
**1.0.0 – 26.3**. Sam plik binarny potwierdza to w logu: `Highest supported version by the proxy: 26.3 (777)`.

---

## 1. Wymagania

- **Node.js 18+** (repo testowane na 22; do uruchomienia Mindcraft potrzebujesz `npm install`).
- **Java 17+** — główny plik `.jar` ViaProxy tego wymaga (jest też osobny build „+java8",
  ale launcher domyślnie pobiera wersję główną). Sprawdź: `java -version`.
- **ViaProxy .jar** — launcher pobiera go z oficjalnych wydań ViaVersion/ViaProxy
  i weryfikuje sumą SHA-256 publikowaną przez wydanie. Wersja jest **przypięta** w configu
  (`proxy.download.pinVersion`, domyślnie `v3.4.14`) i **nigdy nie aktualizuje się sama**.
- Konto Minecraft (tylko gdy serwer docelowy ma `online-mode=true`).

## 2. Pierwsze uruchomienie

```bash
npm install               # zależności Mindcraft
npm run bot:setup         # tworzy launcher.config.json z przykładu (nigdy nie nadpisuje!)
npm run bot:setup -- --download   # pobiera przypiętą wersję ViaProxy (weryfikacja SHA-256)
npm run bot:doctor        # sprawdza config, Javę, jar, profil, zależności, port
```

## 3. Gdzie wpisać adres serwera i nick

Edytuj `launcher.config.json` (utworzony z `launcher.config.example.json`):

```jsonc
{
    "server": {
        "host": "mc.example.org",   // adres docelowego serwera Minecraft
        "port": 25565,
        "version": "26.3"           // wersja SERWERA (trafia do ViaProxy)
    },
    "account": {
        "username": "MojNickMinecraft", // Twój nick w grze (patrz niżej!)
        "auth": "microsoft",            // albo "offline" dla serwerów offline
        "accountIndex": 0               // który zapisany konto z listy ViaProxy użyć
    },
    "proxy": {
        "bindHost": "127.0.0.1",    // proxy nasłuchuje tylko lokalnie (domyślnie)
        "bindPort": 25568
    },
    "mindcraft": {
        "clientVersion": "1.21.6",  // wersja protokołu BOTA (trafia do Mindcraft)
        "profilePath": "./andy.json"
    }
}
```

**Nick to nazwa w grze (in-game name), NIE adres e-mail konta Microsoft.**
E-mail podajesz dopiero podczas logowania Microsoft w ViaProxy (punkt 4).
Nick powinien być zgodny z nazwą profilu Minecraft Twojego konta — to ona pojawi się
na serwerze. `bot:doctor` i `bot:setup -- --login` ostrzegą, jeśli się różnią.

**Adres i wersja serwera należą do konfiguracji ViaProxy; bot łączy się z lokalnym proxy
wersją `mindcraft.clientVersion`** (np. `1.21.6`), a ViaProxy tłumaczy ruch do wersji serwera
(np. `26.3`). Ustawień `host`/`port` w `settings.js` nie musisz zmieniać — launcher nadpisuje
je w pamięci procesu przez istniejący mechanizm `SETTINGS_JSON` (Twój `settings.js` i
oryginalny profil pozostają nietknięte).

## 4. Jak zalogować konto Microsoft (jednorazowo)

```bash
npm run bot:setup -- --login
```

Launcher uruchomi ViaProxy z interaktywną konsolą. Wpisz w niej:

```
account add microsoft
```

ViaProxy wyświetli **link i kod** (oficjalny *device code flow*) — otwórz link w przeglądarce,
zaloguj się kontem Microsoft i wpisz kod. Następnie `account list` pokaże zapisane konta,
a po zakończeniu (Ctrl+C) launcher sprawdzi, czy konto da się wybrać automatycznie
(`--auth-method ACCOUNT --minecraft-account-index`).

Alternatywnie możesz uruchomić `java -jar .local/viaproxy/ViaProxy.jar` (GUI) i dodać konto
w zakładce **Accounts** — oba sposoby są oficjalnymi mechanizmami ViaProxy.

> **Ważne:** wpis konta w `launcher.config.json` **nie zastępuje zalogowania do Microsoft**.
> Config mówi tylko, *które* zapisane konto ViaProxy ma użyć. Tokeny są przechowywane przez
> ViaProxy w `.local/runtime/viaproxy/saves.json` — **nigdy nie udostępniaj tego pliku**.
> Launcher nigdy go nie wyświetla i nie przepuszcza tokenów przez logi.

## 5. Codzienny start

```bash
npm run bot:start
```

Launcher: waliduje config → sprawdza Javę/jar/profil/zależności/port → generuje pliki runtime
→ startuje ViaProxy → czeka na gotowość portu (limit `proxy.startupTimeoutMs`) → dopiero wtedy
startuje Mindcraft → pokazuje logi z prefiksami `[ViaProxy]` i `[Mindcraft]` (dodatkowo w
`.local/runtime/logs/`). **Ctrl+C zamyka oba procesy i ich procesy potomne**; awaria jednego
procesu sprząta drugi i zwraca kod błędu. Brak restartów i auto-aktualizacji.

## 6. Typowe błędy i lokalizacja logów

Logi sesji: `.local/runtime/logs/viaproxy.log` i `.local/runtime/logs/mindcraft.log`.

| Komunikat | Co zrobić |
|---|---|
| `Configuration file not found` | `npm run bot:setup` |
| `server.port must be an integer in the 1-65535 range` itp. | popraw `launcher.config.json` |
| `Java not found` / wersja < 17 | zainstaluj JDK/JRE 17+ lub ustaw `proxy.javaPath` |
| `ViaProxy file not found` | `npm run bot:setup -- --download` |
| `Port ... is already in use` | zabij starą instancję lub zmień `proxy.bindPort` |
| `No Microsoft accounts saved` (serwery online) | `npm run bot:setup -- --login` |
| `SHA-256 checksum ... does not match` | pobieranie przerwane/uszkodzone; spróbuj ponownie |
| `[Mindcraft] Error getting server ... version is incorrect` | **oczekiwane**: ViaProxy ogłasza wersję serwera docelowego (np. 26.3), a bot łączy się wersją `clientVersion` — Mindcraft kontynuuje poprawną wersją |
| `API key ... not found` | uzupełnij `keys.json` (patrz `keys.example.json`) — jak w zwykłym Mindcraft |
| `Failed to start agent process` | patrz wyżej w logu `[Mindcraft]`; launcher sam zamyka oba procesy |

`npm run bot:doctor` raportuje po angielsku i **wyraźnie rozdziela** „Local configuration: OK”
od „Server connection and Microsoft login: NOT TESTED” (opcjonalny `--probe` sprawdza wyłącznie
osiągalność TCP serwera — nie logowanie).

## Uwagi bezpieczeństwa

- Proxy domyślnie nasłuchuje na `127.0.0.1` — nie wystawiaj `proxy.bindHost` na `0.0.0.0`.
- `launcher.config.json`, `.local/` (jar, runtime, konta, logi) są w `.gitignore`.
- `allow_insecure_coding` pozostaje wyłączone — launcher go nie włącza.
- Pobieranie tylko z oficjalnych wydań `ViaVersion/ViaProxy`, konkretna przypięta wersja,
  weryfikacja SHA-256 z metadanych wydania, zapis przez plik tymczasowy `.part`.

## Czego launcher nie robi / czego nie da się zagwarantować bez Twojego konta

- Nie potwierdzi **faktycznego logowania** do serwera (to wymaga prawdziwego konta Microsoft,
  sieci i działającego serwera) — do tego służy `npm run bot:start` na prawdziwym serwerze.
- Zgodność **26.3 jako wersji serwera** potwierdziłem w README tagu `v3.4.14` i w logu
  pobranego pliku binarnego; czy *Twój* serwer 26.3 przyjmie bota — zweryfikuj startem.
