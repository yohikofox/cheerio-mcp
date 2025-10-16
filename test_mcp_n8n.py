#!/usr/bin/env python3
"""
Script de test pour Cheerio MCP - Compatible n8n
Ce script peut être utilisé dans un node Python de n8n ou exécuté directement
"""

import json
import urllib.request
import urllib.parse
import urllib.error
from typing import Dict, Any, List, Optional
import os
from datetime import datetime

class MCPTester:
    """Client pour tester le serveur MCP Cheerio"""
    
    def __init__(self, base_url: str = "http://localhost:3000"):
        self.base_url = base_url
        self.mcp_endpoint = f"{base_url}/mcp"
        self.request_id = 1
        
    def _make_request(self, method: str, params: Optional[Dict] = None) -> Dict[str, Any]:
        """Effectue une requête JSON-RPC 2.0 vers le serveur MCP"""
        payload = {
            "jsonrpc": "2.0",
            "id": self.request_id,
            "method": method,
            "params": params
        }
        
        self.request_id += 1
        
        try:
            data = json.dumps(payload).encode('utf-8')
            req = urllib.request.Request(
                self.mcp_endpoint,
                data=data,
                headers={"Content-Type": "application/json"}
            )
            
            with urllib.request.urlopen(req, timeout=30) as response:
                return json.loads(response.read().decode('utf-8'))
                
        except (urllib.error.URLError, urllib.error.HTTPError) as e:
            return {
                "error": f"Request failed: {str(e)}",
                "payload": payload
            }
        except Exception as e:
            return {
                "error": f"Unexpected error: {str(e)}",
                "payload": payload
            }
    
    def initialize(self) -> Dict[str, Any]:
        """Initialise la connexion MCP"""
        return self._make_request("initialize")
    
    def list_tools(self) -> Dict[str, Any]:
        """Liste tous les outils disponibles"""
        return self._make_request("tools/list")
    
    def search_web(self, query: str, engines: List[str] = None, max_results: int = 5) -> Dict[str, Any]:
        """Effectue une recherche web"""
        if engines is None:
            engines = ["google", "duckduckgo", "bing"]
            
        params = {
            "name": "search_web",
            "arguments": {
                "query": query,
                "engines": engines,
                "maxResults": max_results
            }
        }
        return self._make_request("tools/call", params)
    
    def scrape_page(self, url: str) -> Dict[str, Any]:
        """Extrait le contenu d'une page web"""
        params = {
            "name": "scrape_page",
            "arguments": {
                "url": url
            }
        }
        return self._make_request("tools/call", params)
    
    def scrape_multiple_pages(self, urls: List[str]) -> Dict[str, Any]:
        """Extrait le contenu de plusieurs pages web"""
        params = {
            "name": "scrape_multiple_pages",
            "arguments": {
                "urls": urls
            }
        }
        return self._make_request("tools/call", params)
    
    def search_and_scrape(self, query: str, engine: str = "duckduckgo", max_results: int = 3) -> Dict[str, Any]:
        """Recherche et extrait le contenu des résultats"""
        params = {
            "name": "search_and_scrape",
            "arguments": {
                "query": query,
                "engine": engine,
                "maxResults": max_results
            }
        }
        return self._make_request("tools/call", params)
    
    def search_and_scrape_dynamic(self, query: str, engine: str = "duckduckgo", 
                                  max_results: int = 3, format: str = "yaml") -> Dict[str, Any]:
        """Recherche et extrait le contenu avec Playwright (sites JavaScript)"""
        params = {
            "name": "search_and_scrape_dynamic",
            "arguments": {
                "query": query,
                "engine": engine,
                "maxResults": max_results,
                "format": format
            }
        }
        return self._make_request("tools/call", params)


def format_results(results: Dict[str, Any], verbose: bool = False) -> str:
    """Formate les résultats pour affichage"""
    output = []
    
    if "error" in results:
        output.append(f"❌ Erreur: {results['error']}")
        if verbose and "payload" in results:
            output.append(f"Payload: {json.dumps(results['payload'], indent=2)}")
    elif "result" in results:
        result = results["result"]
        if "content" in result and len(result["content"]) > 0:
            content = result["content"][0].get("text", "")
            try:
                # Essayer de parser comme JSON pour un meilleur affichage
                parsed = json.loads(content)
                if isinstance(parsed, list):
                    output.append(f"✅ Succès - {len(parsed)} résultat(s)")
                    if verbose:
                        for i, item in enumerate(parsed[:2]):  # Limiter à 2 pour la lisibilité
                            output.append(f"\n--- Résultat {i+1} ---")
                            output.append(json.dumps(item, indent=2, ensure_ascii=False)[:500] + "...")
                else:
                    output.append(f"✅ Succès")
                    if verbose:
                        output.append(json.dumps(parsed, indent=2, ensure_ascii=False)[:1000] + "...")
            except json.JSONDecodeError:
                # Si ce n'est pas du JSON (ex: YAML), afficher tel quel
                output.append(f"✅ Succès - Format: {result.get('format', 'text')}")
                if verbose:
                    output.append(content[:1000] + "..." if len(content) > 1000 else content)
        else:
            output.append(f"✅ Succès: {json.dumps(result, indent=2, ensure_ascii=False)[:500]}")
    else:
        output.append(f"⚠️ Réponse inattendue: {json.dumps(results, indent=2)[:500]}")
    
    return "\n".join(output)


def save_results(results: Dict[str, Any], query: str = None) -> str:
    """Sauvegarde les résultats dans le dossier data avec horodatage"""
    # Créer le dossier data s'il n'existe pas
    data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
    os.makedirs(data_dir, exist_ok=True)
    
    # Créer le nom de fichier avec horodatage
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    query_slug = ""
    if query:
        # Créer un slug à partir de la query (enlever caractères spéciaux)
        query_slug = "_" + "".join(c if c.isalnum() or c in ['-', '_'] else '_' 
                                   for c in query[:30])
    
    filename = f"mcp_test_{timestamp}{query_slug}.json"
    filepath = os.path.join(data_dir, filename)
    
    # Ajouter les métadonnées
    output = {
        "timestamp": datetime.now().isoformat(),
        "query": query,
        "results": results,
        "summary": {
            "total_tests": len(results),
            "successful": sum(1 for r in results.values() if "error" not in r and "result" in r),
            "failed": sum(1 for r in results.values() if "error" in r)
        }
    }
    
    # Sauvegarder le fichier
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    
    return filepath


def run_tests(base_url: str = "http://localhost:3000", verbose: bool = True, save_to_file: bool = True):
    """Exécute une série de tests sur le serveur MCP"""
    
    tester = MCPTester(base_url)
    results = {}
    
    print("🚀 Démarrage des tests MCP Cheerio")
    print(f"📍 URL: {base_url}")
    print("-" * 50)
    
    # Test 1: Initialisation
    print("\n1️⃣ Test d'initialisation...")
    results["init"] = tester.initialize()
    print(format_results(results["init"], verbose))
    
    # Test 2: Liste des outils
    print("\n2️⃣ Test de listing des outils...")
    results["tools"] = tester.list_tools()
    if "result" in results["tools"] and "tools" in results["tools"]["result"]:
        tools = results["tools"]["result"]["tools"]
        print(f"✅ {len(tools)} outils disponibles:")
        for tool in tools:
            print(f"  - {tool['name']}: {tool['description'][:60]}...")
    
    # Test 3: Recherche web produit
    print("\n3️⃣ Test de recherche produit...")
    query = "iphone 7 pro max 1To Orange Cosmic France"
    results["search"] = tester.search_web(query, ["duckduckgo"], 3)
    print(format_results(results["search"], verbose))
    
    # Test 4: Scraping d'une page
    print("\n4️⃣ Test de scraping d'une page...")
    test_url = "https://www.apple.com/fr/"
    results["scrape"] = tester.scrape_page(test_url)
    print(format_results(results["scrape"], False))  # Moins verbose pour le scraping
    
    # Test 5: Recherche et scraping dynamique
    print("\n5️⃣ Test de recherche et scraping dynamique...")
    results["dynamic"] = tester.search_and_scrape_dynamic(
        "MacBook Pro M3 Prix France",
        engine="duckduckgo",
        max_results=2,
        format="yaml"
    )
    print(format_results(results["dynamic"], verbose))
    
    print("\n" + "=" * 50)
    print("📊 Résumé des tests:")
    success_count = sum(1 for r in results.values() if "error" not in r and "result" in r)
    total_count = len(results)
    print(f"✅ Succès: {success_count}/{total_count}")
    print(f"❌ Erreurs: {total_count - success_count}/{total_count}")
    
    # Sauvegarder les résultats si demandé
    if save_to_file:
        # Extraire la query utilisée dans les tests
        test_query = "iphone 7 pro max 1To Orange Cosmic France"
        filepath = save_results(results, test_query)
        print(f"\n💾 Résultats sauvegardés dans: {filepath}")
    
    return results


# Pour utilisation dans n8n
def main():
    """Fonction principale pour n8n ou exécution directe"""
    
    # Configuration (peut être passée via variables d'environnement dans n8n)
    import os
    base_url = os.environ.get("MCP_BASE_URL", "http://localhost:3000")
    verbose = os.environ.get("MCP_VERBOSE", "true").lower() == "true"
    
    # Exécuter les tests
    results = run_tests(base_url, verbose)
    
    # Retourner les résultats pour n8n
    return {
        "success": all("error" not in r for r in results.values()),
        "results": results,
        "summary": {
            "total_tests": len(results),
            "successful": sum(1 for r in results.values() if "error" not in r),
            "failed": sum(1 for r in results.values() if "error" in r)
        }
    }


# Code pour n8n Python node
# Copier ce qui suit dans le node Python de n8n
"""
# Pour n8n, utiliser ce code dans un Python node:

import requests
import json

def test_mcp_search(query, base_url="http://localhost:3000"):
    mcp_endpoint = f"{base_url}/mcp"
    
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
        response = requests.post(
            mcp_endpoint,
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=30
        )
        response.raise_for_status()
        result = response.json()
        
        if "result" in result and "content" in result["result"]:
            content = json.loads(result["result"]["content"][0]["text"])
            return {
                "success": True,
                "query": query,
                "results_count": sum(len(engine.get("results", [])) for engine in content),
                "data": content
            }
        else:
            return {"success": False, "error": "Invalid response format", "raw": result}
            
    except Exception as e:
        return {"success": False, "error": str(e)}

# Utilisation dans n8n:
# result = test_mcp_search("iphone 15 pro max prix")
# return result
"""

if __name__ == "__main__":
    # Exécution directe du script
    result = main()
    print("\n🎯 Résultat final (format JSON):")
    print(json.dumps(result["summary"], indent=2))