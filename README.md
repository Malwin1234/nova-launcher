# Nova Launcher

Ein eigener Minecraft-Launcher für Windows (Electron).

## Funktionen
- Anmeldung mit Microsoft-Konto (Token wird verschlüsselt per Windows DPAPI gespeichert)
- Instanzen mit getrennten Spielordnern (Vanilla oder Fabric, alle Releases und Snapshots)
- Modrinth-Browser für Mods, Resource Packs und Shader inkl. Pflicht-Abhängigkeiten
- Passende Java-Laufzeit (Eclipse Temurin) wird automatisch heruntergeladen
- Offline-Modus: Start ohne Anmeldeserver (Einzelspieler/LAN), nach einmaliger Microsoft-Anmeldung
- Skin-Editor: Presets kombinieren, selber pixeln, 3D-Vorschau, als PNG speichern oder aufs Konto hochladen
- Arbeitsspeicher einstellbar, Live-Protokoll des Spiels

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

Spieldaten liegen unter `%APPDATA%\NovaLauncher`.

Kein offizielles Minecraft-Produkt. Nicht von Mojang oder Microsoft genehmigt oder mit ihnen verbunden.
