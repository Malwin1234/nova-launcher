# Nova Launcher

Ein eigener Minecraft-Launcher für Windows (Electron).

## Funktionen
- **Konten:** mehrere Microsoft-Konten, Wechsel per Klick (Token verschlüsselt per Windows DPAPI)
- **Instanzen:** getrennte Spielordner, Vanilla, Fabric, Quilt, Forge und NeoForge, alle Releases und Snapshots;
  umbenennen, duplizieren, Version/Loader wechseln, eigener Arbeitsspeicher und JVM-Argumente
- **Weiterspielen:** Schnellstart für die letzten 10 gespielten Welten und Server
- **Modrinth:** Mods, Resource Packs und Shader suchen und installieren, Mods an/aus, Mod-Updates
- **Modpacks:** Modrinth-Modpacks suchen und installieren, `.mrpack`-Import
- **Skin-Editor:** Presets kombinieren, selber pixeln (auch direkt auf der 3D-Figur), Spiegeln, klassisch/schlank,
  Import, als PNG speichern oder aufs Konto hochladen
- **Start:** passende Java-Laufzeit (Eclipse Temurin, mit Prüfsumme) wird automatisch geladen; Fortschritt mit Phasen
  und Dateizählern; verständliche Absturzmeldung mit Log-Ordner
- **Offline-Modus:** Start ohne Anmeldeserver (Einzelspieler/LAN) nach einmaliger Microsoft-Anmeldung
- **Auto-Updates** über GitHub-Releases (funktioniert nur, wenn das Repository öffentlich ist)

## Installation
`NovaLauncher-Setup-<version>.exe` aus den Releases herunterladen und ausführen.
Der Installer ist nicht signiert, daher zeigt Windows SmartScreen eine Warnung
("Weitere Informationen" → "Trotzdem ausführen").

## Entwicklung
```
npm install
npm start      # Launcher starten
npm run dist   # Installer nach dist/ bauen
```
Automatischer Starttest (ohne Microsoft-Login, eigener Datenordner):
```
NOVA_TEST=1 NOVA_DATA_DIR=<leerer Ordner> node_modules/electron/dist/electron.exe scripts/test-launch.js 26.3:fabric 1.21.1:neoforge
```

## Release
Zu jedem GitHub-Release gehören drei Dateien aus `dist/`, alle aus demselben Build:
`NovaLauncher-Setup-<version>.exe`, `NovaLauncher-Setup-<version>.exe.blockmap` und `latest.yml`.
Tag `v<version>`, als normales Release (kein Entwurf, keine Vorabversion).

Spieldaten liegen unter `%APPDATA%\NovaLauncher`.

Kein offizielles Minecraft-Produkt. Nicht von Mojang oder Microsoft genehmigt oder mit ihnen verbunden.

## Lizenz
MIT, siehe [LICENSE](LICENSE). Minecraft selbst, die Spieldateien und Inhalte von Modrinth unterliegen ihren eigenen Lizenzen
und sind nicht Teil dieses Repositorys.
