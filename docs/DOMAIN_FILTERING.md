# Filtrage par domaine des résultats de recherche

## Description

Le serveur MCP Cheerio prend désormais en charge le filtrage des résultats de recherche par domaine. Cette fonctionnalité vous permet de limiter les résultats aux sites spécifiques que vous souhaitez (par exemple, fnac.com, cdiscount.com, amazon.fr).

## Fonctions supportées

Le filtrage par domaine est disponible pour les outils suivants :
- `search_web` - Recherche web simple
- `search_and_scrape` - Recherche et scraping des résultats
- `search_and_scrape_dynamic` - Recherche et scraping avec Playwright

## Utilisation

### Paramètre `allowedDomains`

Ajoutez le paramètre optionnel `allowedDomains` avec un tableau de domaines autorisés :

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "search_web",
    "arguments": {
      "query": "iPhone 17 prix",
      "engines": ["duckduckgo"],
      "maxResults": 10,
      "allowedDomains": ["fnac.com", "cdiscount.com", "amazon.fr"]
    }
  }
}
```

### Exemples

#### Exemple 1: Recherche sans filtrage

```python
payload = {
    'jsonrpc': '2.0',
    'id': 1,
    'method': 'tools/call',
    'params': {
        'name': 'search_web',
        'arguments': {
            'query': 'iPhone 17 prix',
            'engines': ['duckduckgo'],
            'maxResults': 10
        }
    }
}
# Résultat : 10 résultats de divers domaines
```

#### Exemple 2: Recherche avec filtrage

```python
payload = {
    'jsonrpc': '2.0',
    'id': 1,
    'method': 'tools/call',
    'params': {
        'name': 'search_web',
        'arguments': {
            'query': 'iPhone 17 prix',
            'engines': ['duckduckgo'],
            'maxResults': 10,
            'allowedDomains': ['fnac.com', 'cdiscount.com', 'amazon.fr']
        }
    }
}
# Résultat : Seuls les résultats de fnac.com, cdiscount.com et amazon.fr
```

#### Exemple 3: Search and scrape avec filtrage

```python
payload = {
    'jsonrpc': '2.0',
    'id': 1,
    'method': 'tools/call',
    'params': {
        'name': 'search_and_scrape_dynamic',
        'arguments': {
            'query': 'iPhone 17',
            'engine': 'google',
            'maxResults': 5,
            'format': 'yaml',
            'allowedDomains': ['fnac.com', 'boulanger.com']
        }
    }
}
# Résultat : Recherche, filtre et scrape seulement fnac.com et boulanger.com
```

## Format de réponse

Lorsque le filtrage est appliqué, la réponse inclut des métadonnées supplémentaires :

```json
{
  "engine": "duckduckgo",
  "query": "iPhone 17 prix",
  "results": [...],
  "filteredBy": ["fnac.com", "cdiscount.com", "amazon.fr"],
  "originalCount": 10,
  "filteredCount": 3
}
```

### Champs supplémentaires

- `filteredBy` : Liste des domaines utilisés pour le filtrage
- `originalCount` : Nombre de résultats avant filtrage
- `filteredCount` : Nombre de résultats après filtrage

## Comportement

### Correspondance des domaines

Le système de filtrage :
- ✅ Ignore le préfixe `www.`
- ✅ Est insensible à la casse
- ✅ Accepte les correspondances partielles (ex: `fnac.com` correspond à `www.fnac.com` et `m.fnac.com`)
- ✅ Vérifie que le domaine se termine par ou contient le domaine spécifié

### Exemples de correspondance

| Domain autorisé | URLs correspondantes |
|-----------------|---------------------|
| `fnac.com` | ✅ `www.fnac.com`, `m.fnac.com`, `fnac.com` |
| `amazon.fr` | ✅ `www.amazon.fr`, `amazon.fr` |
| `cdiscount.com` | ✅ `www.cdiscount.com`, `m.cdiscount.com` |

### Sans filtrage

Si le paramètre `allowedDomains` n'est pas fourni ou est un tableau vide, tous les résultats sont retournés sans filtrage.

## Cas d'usage

### 1. Comparaison de prix e-commerce

Rechercher des produits uniquement sur vos sites e-commerce préférés :

```python
allowedDomains = ['fnac.com', 'cdiscount.com', 'darty.com', 'boulanger.com']
```

### 2. Veille concurrentielle

Surveiller les prix de vos concurrents spécifiques :

```python
allowedDomains = ['competitor1.com', 'competitor2.com']
```

### 3. Sources fiables

Limiter les recherches à des sources d'information spécifiques :

```python
allowedDomains = ['lesnumeriques.com', 'frandroid.com', 'tomsguide.fr']
```

## Test

Un script de test est disponible pour valider la fonctionnalité :

```bash
python3 test_domain_filter.py
```

## Performance

Le filtrage est appliqué **après** la recherche, ce qui signifie :
- Les moteurs de recherche retournent toujours `maxResults` résultats
- Le filtrage réduit ensuite ce nombre aux domaines autorisés
- Si aucun résultat ne correspond, vous obtiendrez un tableau vide

**Conseil** : Augmentez `maxResults` si vous filtrez sur peu de domaines pour avoir plus de chances d'obtenir des résultats.

## Notes techniques

- La fonction de filtrage est définie dans `src/server-http.ts`
- Le filtrage utilise l'API `URL` native pour parser les domaines
- Les URLs invalides sont automatiquement exclues