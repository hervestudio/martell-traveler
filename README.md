# Martell — The Journey

Prototype Three.js (Hervé Studio) centré sur le **character design** : un personnage composé de filaments lumineux jaune pâle qui suit un chemin luminescent entre des collines, vers une montagne. Le focus est sur le personnage et son mouvement.

## Démo
👉 https://hervestudio.github.io/martell-traveler/

## Le personnage
- Uniquement des **filaments** (tubes lisses) partant tous d'un **point commun**, puis évoluant indépendamment.
- Traînée basée sur l'historique des positions de la tête + onde perpendiculaire propre à chaque brin.
- **Progression** : 1 spline fine au départ → elle grossit → de nouvelles splines apparaissent (en se construisant depuis le point commun) jusqu'à 5 splines à l'épaisseur max, au fil des sphères récupérées.
- **Onde de turbulence** qui remonte les splines à chaque sphère mangée + flash d'émission.
- Ombre projetée par chaque fil, bloom sélectif (perso / chemin dissociés).

## Gameplay
Le personnage suit le chemin et **récupère les sphères** en passant en leur centre (certaines sont atteignables, d'autres à l'écart). Plus il en mange, plus il s'épaissit et gagne des splines.

## Contrôles
- **C** — caméra suivi / libre
- **Espace** — pause
- Panneau **GUI** (haut droite) : réglages du chemin, du personnage (attitude, placement, visuel) et des sphères.

## Stack
Three.js (modules ES via CDN jsdelivr), `lil-gui`, post-processing (bloom sélectif + OutputPass). Aucun build : `index.html` + `main.js` + `traveler.js`.

## Lancer en local
```bash
python -m http.server 8123
# puis http://localhost:8123/index.html
```
