"""
Script Python pour n8n - Test MCP Cheerio
Copiez ce code dans un node "Execute Code" Python dans n8n
"""

import json
import urllib.request
import urllib.error
import os
from datetime import datetime

def test_mcp_search(query, base_url="http://localhost:3000"):
    """
    Teste la recherche MCP avec une requête produit
    
    Args:
        query: La requête de recherche (ex: "iphone 15 pro max prix")
        base_url: L'URL du serveur MCP (par défaut localhost:3000)
    
    Returns:
        Dict avec les résultats ou erreur
    """
    mcp_endpoint = f"{base_url}/mcp"
    
    # Préparer la requête JSON-RPC 2.0
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {
            "name": "search_web",
            "arguments": {
                "query": query,
                "engines": ["google", "duckduckgo", "bing"],
                "maxResults": 5
            }
        }
    }
    
    try:
        # Encoder les données
        data = json.dumps(payload).encode('utf-8')
        
        # Créer la requête
        req = urllib.request.Request(
            mcp_endpoint,
            data=data,
            headers={"Content-Type": "application/json"}
        )
        
        # Exécuter la requête
        with urllib.request.urlopen(req, timeout=30) as response:
            result = json.loads(response.read().decode('utf-8'))
        
        # Analyser la réponse
        if "result" in result and "content" in result["result"]:
            content_text = result["result"]["content"][0]["text"]
            content = json.loads(content_text)
            
            # Compter les résultats
            total_results = 0
            engines_with_results = []
            all_urls = []
            
            for engine_data in content:
                engine_name = engine_data.get("engine", "Unknown")
                results = engine_data.get("results", [])
                if results:
                    total_results += len(results)
                    engines_with_results.append(engine_name)
                    for r in results:
                        all_urls.append({
                            "engine": engine_name,
                            "title": r.get("title", ""),
                            "url": r.get("url", "")
                        })
            
            return {
                "success": True,
                "query": query,
                "total_results": total_results,
                "engines_with_results": engines_with_results,
                "top_results": all_urls[:10],  # Top 10 résultats
                "raw_data": content
            }
        else:
            return {
                "success": False,
                "error": "Format de réponse invalide",
                "raw": result
            }
            
    except urllib.error.HTTPError as e:
        return {
            "success": False,
            "error": f"Erreur HTTP: {e.code} - {e.reason}",
            "query": query
        }
    except urllib.error.URLError as e:
        return {
            "success": False,
            "error": f"Erreur de connexion: {str(e)}",
            "query": query
        }
    except Exception as e:
        return {
            "success": False,
            "error": f"Erreur inattendue: {str(e)}",
            "query": query
        }


def test_scrape_dynamic(query, base_url="http://localhost:3000", max_results=3):
    """
    Teste la recherche et le scraping dynamique avec Playwright
    
    Args:
        query: La requête de recherche
        base_url: L'URL du serveur MCP
        max_results: Nombre de résultats à scraper (1-10)
    
    Returns:
        Dict avec les données scrapées ou erreur
    """
    mcp_endpoint = f"{base_url}/mcp"
    
    payload = {
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/call",
        "params": {
            "name": "search_and_scrape_dynamic",
            "arguments": {
                "query": query,
                "engine": "duckduckgo",
                "maxResults": max_results,
                "format": "yaml"
            }
        }
    }
    
    try:
        data = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(
            mcp_endpoint,
            data=data,
            headers={"Content-Type": "application/json"}
        )
        
        with urllib.request.urlopen(req, timeout=60) as response:
            result = json.loads(response.read().decode('utf-8'))
        
        if "result" in result and "content" in result["result"]:
            yaml_content = result["result"]["content"][0]["text"]
            
            # Parser basiquement le YAML pour extraire les URLs et titres
            pages = yaml_content.split("---\n")
            scraped_data = []
            
            for page in pages:
                if "url:" in page and "title:" in page:
                    lines = page.split("\n")
                    url = ""
                    title = ""
                    for line in lines:
                        if line.startswith("url:"):
                            url = line.replace("url:", "").strip()
                        elif line.startswith("title:"):
                            title = line.replace("title:", "").strip()
                    
                    if url and title:
                        scraped_data.append({
                            "url": url,
                            "title": title,
                            "scraped": True
                        })
            
            return {
                "success": True,
                "query": query,
                "pages_scraped": len(scraped_data),
                "data": scraped_data,
                "raw_yaml": yaml_content[:1000] + "..." if len(yaml_content) > 1000 else yaml_content
            }
        else:
            return {
                "success": False,
                "error": "Format de réponse invalide",
                "raw": result
            }
            
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "query": query
        }


def save_results_to_file(results, query, save_dir="/Users/yoannlorho/ws/cheerio-mcp/data"):
    """
    Sauvegarde les résultats dans un fichier JSON avec horodatage
    
    Args:
        results: Dict avec les résultats des tests
        query: La requête utilisée
        save_dir: Répertoire de sauvegarde (par défaut ./data)
    
    Returns:
        Le chemin du fichier sauvegardé
    """
    # Créer le dossier s'il n'existe pas
    os.makedirs(save_dir, exist_ok=True)
    
    # Créer le nom de fichier avec horodatage
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    
    # Créer un slug à partir de la query (max 40 caractères, alphanum uniquement)
    query_slug = "".join(c if c.isalnum() or c in ['-', '_'] else '_' 
                        for c in query[:40])
    
    filename = f"n8n_mcp_{timestamp}_{query_slug}.json"
    filepath = os.path.join(save_dir, filename)
    
    # Préparer les données avec métadonnées
    data_to_save = {
        "timestamp": datetime.now().isoformat(),
        "query": query,
        "results": results,
        "statistics": {
            "search_success": results.get("search", {}).get("success", False),
            "total_results_found": results.get("search", {}).get("total_results", 0),
            "engines_with_results": results.get("search", {}).get("engines_with_results", []),
            "scrape_success": results.get("scrape", {}).get("success", False) if "scrape" in results else None,
            "pages_scraped": results.get("scrape", {}).get("pages_scraped", 0) if "scrape" in results else None
        }
    }
    
    # Sauvegarder le fichier
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(data_to_save, f, indent=2, ensure_ascii=False)
    
    return filepath


# ========================================
# CODE PRINCIPAL POUR N8N
# ========================================

# Configuration (peut être passée via les variables n8n)
base_url = "http://localhost:3000"  # Ou utilisez $json.base_url dans n8n
query = "iphone 7 pro max 1To Orange Cosmic France"  # Ou utilisez $json.query dans n8n
save_to_file = True  # Mettre à False si vous ne voulez pas sauvegarder

# Test 1: Recherche simple
search_result = test_mcp_search(query, base_url)

# Test 2: Recherche avec scraping dynamique (optionnel)
# scrape_result = test_scrape_dynamic(query, base_url, 2)

# Retourner les résultats pour n8n
output = {
    "search": search_result,
    # "scrape": scrape_result  # Décommentez si vous voulez aussi le scraping
}

# Sauvegarder les résultats si demandé
saved_file = None
if save_to_file:
    saved_file = save_results_to_file(output, query)
    output["saved_file"] = saved_file

# Pour n8n, retournez simplement output
# return output

# Pour test local, affichons les résultats
if __name__ == "__main__":
    print(json.dumps(output, indent=2, ensure_ascii=False))
    if saved_file:
        print(f"\n💾 Résultats sauvegardés dans: {saved_file}")