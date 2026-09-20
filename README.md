# Générateur de vidéos IA — guide de mise en route

## Ce que fait l'application
Vous écrivez une description ("prompt"), l'application lance la génération vidéo
via l'API Higgsfield, et enregistre le résultat dans une galerie que vous pouvez
consulter et télécharger — même des jours plus tard, même si vous n'avez pas
laissé votre ordinateur allumé, **à condition que l'application soit hébergée**
(voir plus bas).

## Testé et validé
- ✅ 1 demande : créée → traitée → résultat visible dans la galerie
- ✅ 10 demandes en parallèle : aucune perte, aucun conflit, 10 identifiants uniques
- ✅ Persistance : les résultats restent après un redémarrage du serveur

Ces tests ont été faits en **mode simulation** (`MOCK_MODE=true`, activé par
défaut) : pas besoin de clé API ni de connexion internet pour vérifier que la
mécanique fonctionne. Vous voyez de fausses vidéos apparaître dans la galerie,
avec de temps en temps un échec simulé (pour tester aussi ce cas).

## Ce qu'il faut pour passer en vrai (3 éléments)

### 1. Une clé API Higgsfield
Sur `console.higgsfield.ai`, récupérez votre **clé** et votre **secret**.

### 2. Un hébergement pour le serveur (obligatoire pour l'automatisation)
C'est le point clé de votre demande : pour que l'application traite les
nouvelles demandes **toute seule, même après avoir fermé votre navigateur**,
le serveur (`server.js`) doit tourner en continu quelque part — pas juste sur
votre ordinateur pendant que vous le regardez.

Options simples (gratuites pour commencer) :
- **Render.com** — le plus simple : connectez ce dossier à un dépôt GitHub,
  Render le fait tourner 24h/24 et vous donne une URL publique automatiquement.
- **Railway.app** — même principe, aussi simple.

Une fois déployé, vous obtenez une adresse du style
`https://mon-app.onrender.com`. C'est cette adresse qui reçoit les
notifications de Higgsfield quand une vidéo est prête (le "webhook").

### 3. Trois variables d'environnement à configurer sur l'hébergeur
```
MOCK_MODE=false
HF_API_KEY=votre_clé
HF_API_SECRET=votre_secret
PUBLIC_URL=https://mon-app.onrender.com   (l'adresse donnée par l'hébergeur)
```

C'est tout. Une fois ces 3 éléments en place, chaque demande envoyée depuis
la page d'accueil :
1. part vers Higgsfield avec l'adresse de webhook incluse,
2. Higgsfield génère la vidéo en arrière-plan (ça peut prendre de 30s à
   quelques minutes selon le modèle),
3. Higgsfield notifie automatiquement votre serveur dès que c'est prêt,
4. le résultat apparaît dans la galerie et reste enregistré définitivement
   dans `data/jobs.json`.

Vous n'avez jamais besoin de garder une conversation ou un onglet ouvert.

## Lancer en local (pour essayer avant de déployer)
```bash
node server.js
```
Puis ouvrez `http://localhost:3000` dans votre navigateur.

## Changer de modèle vidéo
Le modèle par défaut (`bytedance/seedance-2.5/text-to-video`) génère du 720p,
9:16 (format vertical, adapté aux réseaux sociaux), 5 secondes. Pour changer,
modifiez `HF_MODEL_ID` dans les variables d'environnement, ou ajustez les
paramètres directement dans `server.js` (fonction `processJob`).

## Pour vendre cette application à d'autres
Actuellement, une seule clé Higgsfield est utilisée pour tout le monde. Pour
la vendre à plusieurs clients, il faudrait ajouter :
- un système de comptes (chaque utilisateur ne voit que ses propres vidéos),
- une limite de générations par client (pour maîtriser les coûts Higgsfield),
- éventuellement un paiement (Stripe) avant de lancer une génération.

Dites-moi si vous voulez que j'ajoute ces éléments — c'est une suite logique
une fois que la version actuelle tourne bien pour vous seul.
