# Cheerio MCP - Context & Development Log

## Vue d'ensemble du projet

**Cheerio MCP** est un serveur MCP (Model Context Protocol) pour le web scraping intelligent avec Playwright. Il permet de rechercher sur le web, scraper des pages, et analyser automatiquement leur structure pour identifier les meilleurs sélecteurs d'extraction de données.

### Architecture technique

- **Runtime**: Node.js + TypeScript
- **Browser automation**: Playwright (Chromium headless)
- **HTML parsing**: Cheerio
- **Protocol**: MCP over HTTP with Server-Sent Events (SSE)
- **Deployment**: Docker avec VNC/noVNC pour visualisation
- **Port MCP**: 3000
- **Port VNC**: 6080

### Structure du code

```
server/
├── src/
│   ├── server-mcp-http.ts          # Point d'entrée MCP, définition des tools
│   ├── browser-manager.ts           # Singleton pour réutilisation du navigateur
│   ├── scraper-playwright.ts        # Scraping de pages avec scroll et interactions
│   ├── searchEngines-playwright.ts  # Moteurs de recherche (Google, DDG, Bing)
│   ├── page-analyzer.ts             # Analyse de structure de page
│   ├── domain-config-manager.ts     # Stockage des configs par domaine
│   └── noise-detector.ts            # Détection de contenu non pertinent
├── dist/                            # Code compilé
└── domain-configs/                  # Configurations apprises par domaine
```

---

## Fonctionnalités principales

### 1. `search_and_scrape`

Recherche sur plusieurs moteurs et scrape tous les résultats avec agrégation.

**Paramètres**:
- `query`: Requête de recherche
- `engines`: Tableau de moteurs (`google`, `duckduckgo`, `bing`)
- `maxResults`: Nombre max de résultats par moteur
- `outputFormat`: `json` ou `yaml`
- `excludedDomains`: Domaines à exclure des résultats
- `allowedDomains`: Whitelist de domaines (optionnel)

**Workflow**:
1. Recherche parallèle sur tous les moteurs
2. Agrégation et déduplication des URLs
3. Scraping parallèle de toutes les pages
4. Détection de bruit et nettoyage
5. Retour en JSON ou YAML avec estimation de tokens

**Sélecteurs moteurs** (mis à jour 2025-10):
- **Google**: `.MjjYud, .g, div[data-sokoban-container]`
- **DuckDuckGo**: `article[data-testid="result"]`
- **Bing**: `.b_algo`

### 2. `analyze_page_structure`

Analyse une page pour identifier les meilleurs sélecteurs de données.

**Paramètres**:
- `url`: URL de la page à analyser
- `interactionSelectors`: Tableau optionnel de sélecteurs CSS à cliquer (ex: accordéons)

**Ce qui est extrait**:
- **Structured Data**: JSON-LD, Microdata, OpenGraph
- **Product Info**: Title, price, images, brand, SKU, availability, specifications
- **Common Patterns**: BEM, data-attributes, component CSS
- **Accordion Content**: Contenu des accordéons avec parsing en JSON structuré
- **Recommendations**: Suggestions de sélecteurs optimaux

**Sortie**:
```json
{
  "url": "...",
  "title": "...",
  "analysis": {
    "structuredData": [...],
    "productInfo": {
      "title": [{ "selector": "...", "confidence": "high", "value": "..." }],
      "price": [...],
      "images": [...]
    },
    "accordionContent": [{
      "trigger": "Descriptif technique",
      "selector": "#ProductSheetAccordion-content-1",
      "content": "...",
      "html": "...",
      "structured": {
        "Marque": "APPLE",
        "Capacité (mémoire)": "1 To",
        ...
      }
    }],
    "recommendations": [...]
  }
}
```

**Workflow**:
1. Navigation vers la page
2. Fermeture des popups/modals bloquantes
3. Scroll progressif pour charger le lazy content
4. Exécution des `interactionSelectors` (accordéons)
5. Extraction HTML et parsing Cheerio
6. Analyse multi-stratégies (structured data, CSS selectors)
7. Sauvegarde dans `domain-configs/{domain}.json`

### 3. Domain Config Manager

Stocke les configurations apprises pour chaque domaine.

**Structure DomainConfig**:
```typescript
{
  domain: string;
  learnedAt: string;
  lastUsed: string;
  sampleUrl: string;
  productInfo: ProductInfoSelectors;
  structuredData: any[];
  extractionStrategy: 'structured' | 'selectors' | 'hybrid';
  recommendations: string[];
  interactionSelectors?: string[];    // Sélecteurs custom pour accordéons
  accordionContent?: AccordionContent[];  // Contenu extrait
}
```

**Tools**:
- `list_domain_configs`: Liste tous les domaines appris
- `get_domain_config`: Récupère la config d'un domaine
- `update_domain_config`: **[NOUVEAU]** Édite et sauvegarde un schéma de configuration existant

---

## Développements récents (Oct 2025)

### 1. Extraction guidée par domain config (27 Oct 2025)

**Problème**: Le scraper extrayait toujours des données brutes génériques, sans utiliser les configurations de domaine apprises via `analyze_page_structure`.

**Solution**: Le scraper charge maintenant automatiquement la domain config et l'utilise pour guider l'extraction.

**Fonctionnement**:

1. **Lors du scraping** (`scrape_page`, `search_and_scrape`), le scraper :
   - Tente de charger la config du domaine avec `loadDomainConfig(url)`
   - Si config trouvée → utilise `extractDataWithDomainConfig()`
   - Sinon → utilise `extractRawDataFromHtml()` (comportement générique)

2. **Extraction guidée par config** selon `extractionStrategy` :
   - **`structured`** : Parse le JSON-LD et extrait TOUS les champs du type spécifié dans `structuredData`
     ```typescript
     // Extrait automatiquement tous les champs du JSON-LD Product
     Product.brand → { label: "Product.brand", value: "APPLE" }
     Product.name → { label: "Product.name", value: "iPhone 17 Pro Max..." }
     Product.color → { label: "Product.color", value: "Orange" }
     Product.sku → { label: "Product.sku", value: "ip17prom1torange" }
     ```

   - **`selectors`** : Utilise les CSS selectors définis dans `productInfo`
     ```typescript
     // Utilise les sélecteurs définis dans config.productInfo
     productInfo.title[0].selector → h1.product-title
     productInfo.price[0].selector → span.price-final
     ```

   - **`hybrid`** : Essaie `structured` d'abord, puis `selectors` si aucune donnée extraite

3. **Format de sortie** : Chaque item extrait contient :
   ```typescript
   {
     label: "Product.brand",           // Nom du champ
     value: "APPLE",                   // Valeur extraite
     type: "text",                     // Type de donnée
     attributes: {
       source: "structured-data",      // Méthode d'extraction
       format: "json-ld"               // Format source
     }
   }
   ```

**Avantages**:
- ✅ Extraction ciblée uniquement sur les données configurées
- ✅ Moins de bruit dans les résultats
- ✅ Données structurées exploitables directement
- ✅ Workflow "analyze → edit config → scrape" fonctionnel
- ✅ Fallback automatique si pas de config

**Logs ajoutés**:
```
[Scraper] Found domain config for cdiscount.com, using config-guided extraction
[Config-Guided Extraction] Strategy: structured
[Config-Guided Extraction] Extracting structured data...
[Config-Guided Extraction] Extracted 8 items
```

**Cas d'usage**:
1. Analyser une page produit avec `analyze_page_structure`
2. Éditer la config avec `update_domain_config` pour ne garder que les champs souhaités
3. Scraper des pages du même domaine → extraction guidée automatique
4. Mapper les données extraites avec un agent Claude pour la structure finale

### 2. Édition de schémas d'extraction (26 Oct 2025)

**Problème**: Après avoir analysé une page avec `analyze_page_structure`, le schéma généré automatiquement peut nécessiter des ajustements pour mieux cadrer l'extraction.

**Solution**: Nouveau tool `update_domain_config` avec **deux modes d'édition**.

#### Mode 1 : Édition partielle (updates)

**Paramètres**:
- `domain`: Le domaine à modifier (ex: `cdiscount.com`)
- `updates`: Objet partiel avec les champs à modifier
- `mergeMode`: `merge` (par défaut) ou `replace`
  - `merge`: Fusionne avec la config existante
  - `replace`: Remplace tout sauf `domain`, `learnedAt`, `sampleUrl`

**Exemple d'utilisation**:
```json
{
  "tool": "update_domain_config",
  "arguments": {
    "domain": "cdiscount.com",
    "updates": {
      "extractionStrategy": "hybrid",
      "productInfo": {
        "title": [{
          "selector": "h1.product-title",
          "confidence": "high",
          "value": "Custom title selector",
          "method": "Manual override"
        }]
      }
    },
    "mergeMode": "merge"
  }
}
```

#### Mode 2 : Édition complète via textarea (configJson)

**Workflow recommandé** pour édition manuelle complète :

1. **Récupérer** la configuration :
```json
{
  "tool": "get_domain_config",
  "arguments": {
    "domain": "cdiscount.com"
  }
}
```

2. **Éditer** le JSON dans un textarea / éditeur de texte

3. **Sauvegarder** la configuration modifiée :
```json
{
  "tool": "update_domain_config",
  "arguments": {
    "domain": "cdiscount.com",
    "configJson": "{\"domain\":\"cdiscount.com\",\"productInfo\":{...},\"structuredData\":[...],\"extractionStrategy\":\"hybrid\",\"recommendations\":[...]}"
  }
}
```

**Avantages du mode configJson** :
- ✅ Édition visuelle complète dans un éditeur
- ✅ Modification de tous les champs en une seule fois
- ✅ Copier-coller facile entre domaines
- ✅ Validation automatique du JSON
- ✅ Remplacement atomique de la config

**Cas d'usage**:
1. Raffiner les sélecteurs après test du scraping
2. Ajouter des sélecteurs personnalisés non détectés automatiquement
3. Modifier la stratégie d'extraction (structured → hybrid → selectors)
4. Ajuster les `interactionSelectors` pour de meilleurs résultats
5. **Nouveau** : Éditer manuellement toute la configuration dans un textarea

### 2. Support des accordéons et interactions personnalisées

**Problème**: Les sites e-commerce cachent souvent des données importantes dans des accordéons (spécifications, description technique).

**Solution**: Ajout du paramètre `interactionSelectors` à `analyze_page_structure`.

**Exemple d'utilisation**:
```json
{
  "url": "https://www.cdiscount.com/...",
  "interactionSelectors": [
    ".js-accordion__trigger[data-id='description-accordion']"
  ]
}
```

**Fonctionnement**:
1. Détecte l'état `aria-expanded` du trigger
2. Clique uniquement si `aria-expanded="false"` (évite de fermer)
3. Utilise `aria-controls` pour identifier le panneau de contenu
4. Extrait le HTML et le texte du panneau
5. Parse la structure (tables, dl/dt/dd) en JSON

**Parsing structuré**:
- Tables HTML → paires clé-valeur
- Listes de définition (`dl/dt/dd`) → paires clé-valeur
- Divs avec patterns label/value

### 2. Optimisations pour sites avec trackers

**Problème**: Sites comme Samsung.com restent en "pending" à cause de trackers JavaScript qui échouent continuellement.

**Optimisations implémentées**:
- ⏱️ Timeout `networkidle` réduit de 10s → 5s
- 🚀 Scroll 2x plus rapide (steps 800-1200px)
- ⚡ Scroll instantané (`behavior: 'auto'`)
- 🛡️ Timeout max de 30s pour le scroll complet
- ⏭️ Délais réduits entre scrolls (50ms)

**Logs normaux (pas des erreurs)**:
```
*** fb_push ublen NOT ZERO: 671007587
```
Ces messages VNC indiquent des problèmes de sync du framebuffer mais n'impactent pas le scraping.

### 3. Gestion des popups bloquantes

**Sélecteurs de fermeture**:
```typescript
[
  '[aria-label*="Close" i]',
  '[aria-label*="Fermer" i]',
  'button.close',
  'button[class*="close"]',
  'button:has-text("Non merci")',
  'button:has-text("Refuser")',
  'button:has-text("Continuer sans")',
  // + Escape key
]
```

### 4. Détection de bruit améliorée

Filtre automatique des éléments non pertinents:
- Navigation/header/footer
- Menus et sidebars
- Publicités
- Widgets sociaux
- Cookies/GDPR

---

## Configuration et déploiement

### Docker

```bash
# Build
docker-compose build

# Start
docker-compose up -d

# Logs
docker logs server-mcp-server-1 -f

# Hot reload (sans rebuild)
npm run build
docker cp dist/page-analyzer.js server-mcp-server-1:/app/dist/
docker-compose restart mcp-server
```

### VNC Access

```
http://localhost:6080/vnc.html
```
Permet de voir le navigateur Playwright en action.

### Health check

```
http://localhost:3000/health
```

---

## Problèmes connus et limitations

### 1. Sites avec beaucoup de trackers

**Symptômes**:
- Erreurs JS console (`pintrk is not defined`, `gtag is not defined`)
- Scroll qui reste en pending
- Timeout networkidle

**Workaround actuel**: Timeouts réduits et scroll optimisé

**TODO**: Option pour bloquer les domaines de tracking

### 2. Accordéons complexes

**Limitations actuelles**:
- Nécessite `aria-controls` pour trouver le panneau
- Ne gère pas les accordéons imbriqués
- Parsing limité à tables et dl/dt/dd

**TODO**: Support de plus de patterns HTML

### 3. Sites protégés

Certains sites détectent Playwright:
- Cloudflare bot detection
- DataDome
- PerimeterX

**Pas de solution actuelle** (par design pour respecter les robots.txt)

---

## TODOs et roadmap

### Court terme

- [ ] Tester stabilité sur 10+ sites e-commerce différents
- [ ] Améliorer le parsing d'accordéons (plus de patterns)
- [ ] Ajouter logs plus détaillés sur les échecs de scroll
- [ ] Documenter les exemples d'`interactionSelectors` pour sites populaires

### Moyen terme

- [ ] Option `blockTrackers: boolean` pour filtrer analytics/ads
- [ ] Support accordéons imbriqués
- [ ] Extraction des images avec téléchargement optionnel
- [ ] Cache intelligent des domain configs (TTL)
- [ ] Métriques de performance (temps par phase)

### Long terme

- [ ] Auto-learning des `interactionSelectors` (ML?)
- [ ] Support de plus de types de structured data (RDFa, etc.)
- [ ] API REST en plus de MCP
- [ ] UI web pour visualiser les analyses
- [ ] Export vers bases de données (MongoDB, PostgreSQL)

---

## Exemples d'utilisation

### Analyser une page Cdiscount avec accordéons

```json
{
  "tool": "analyze_page_structure",
  "arguments": {
    "url": "https://www.cdiscount.com/telephonie/telephone-mobile/apple-iphone-17-pro-max-1tb/...",
    "interactionSelectors": [
      ".js-accordion__trigger[data-id='description-accordion']"
    ]
  }
}
```

### Rechercher et scraper des produits

```json
{
  "tool": "search_and_scrape",
  "arguments": {
    "query": "iPhone 17 Pro Max",
    "engines": ["google", "duckduckgo"],
    "maxResults": 10,
    "excludedDomains": ["youtube.com", "facebook.com"],
    "outputFormat": "json"
  }
}
```

### Récupérer la config d'un domaine appris

```json
{
  "tool": "get_domain_config",
  "arguments": {
    "domain": "cdiscount.com"
  }
}
```

### Éditer un schéma d'extraction (mode partiel)

```json
{
  "tool": "update_domain_config",
  "arguments": {
    "domain": "cdiscount.com",
    "updates": {
      "extractionStrategy": "hybrid",
      "productInfo": {
        "price": [{
          "selector": "span.price-final",
          "confidence": "high",
          "value": "39.99€",
          "method": "Refined selector"
        }]
      },
      "interactionSelectors": [
        ".js-accordion__trigger[data-id='specs']",
        ".js-accordion__trigger[data-id='description']"
      ]
    },
    "mergeMode": "merge"
  }
}
```

### Workflow complet d'édition via textarea

**Étape 1** : Récupérer la configuration
```json
{
  "tool": "get_domain_config",
  "arguments": {
    "domain": "cdiscount.com"
  }
}
```

**Étape 2** : Copier le JSON retourné dans un éditeur de texte

**Étape 3** : Modifier le JSON (ex: changer extractionStrategy, ajouter sélecteurs)

**Étape 4** : Sauvegarder avec configJson
```json
{
  "tool": "update_domain_config",
  "arguments": {
    "domain": "cdiscount.com",
    "configJson": "{ ... JSON édité complet en string ... }"
  }
}
```

> **Note** : Le paramètre `configJson` attend une **string JSON** (échappée), pas un objet JSON direct.

---

## Notes de développement

### Conventions de code

- **Logs**: Préfixe `[Module]` (ex: `[Page Analyzer]`, `[BrowserManager]`)
- **Erreurs**: Toujours logger avec contexte
- **Timeouts**: Toujours avoir un fallback `.catch()`
- **Selectors**: Commenter pourquoi un sélecteur spécifique est utilisé

### Testing

Actuellement pas de tests automatisés. Tests manuels sur:
- cdiscount.com ✅
- apple.com ✅
- samsung.com ⚠️ (trackers problématiques)
- fnac.com (TODO)
- amazon.fr (TODO)

### Performance

Temps moyens observés:
- `search_and_scrape` (3 moteurs, 10 résultats): ~45-60s
- `analyze_page_structure` (sans accordéons): ~10-15s
- `analyze_page_structure` (avec accordéons): ~15-20s

---

## Références

- [MCP Specification](https://modelcontextprotocol.io/specification)
- [Playwright Documentation](https://playwright.dev/)
- [Cheerio Documentation](https://cheerio.js.org/)
- [Schema.org](https://schema.org/) - Structured data vocabulary

---

**Dernière mise à jour**: 26 octobre 2025
**Contributeurs**: Claude Code AI Assistant
