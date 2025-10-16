#!/usr/bin/env python3
"""
Script de test spécifique pour search_and_scrape_dynamic
Teste la recherche et le scraping de produits avec Playwright
"""

import json
import urllib.request
import urllib.error
from datetime import datetime
import os

def search_and_scrape_dynamic(query, engine="duckduckgo", max_results=5, format="yaml", base_url="http://localhost:3000"):
    """
    Utilise search_and_scrape_dynamic pour rechercher et scraper les données produits
    
    Args:
        query: La requête de recherche produit
        engine: Moteur de recherche (google, duckduckgo, bing)
        max_results: Nombre de résultats à scraper (1-10)
        format: Format de sortie (yaml ou json)
        base_url: URL du serveur MCP
    
    Returns:
        Dict avec les résultats scrapés
    """
    mcp_endpoint = f"{base_url}/mcp"
    
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {
            "name": "search_and_scrape_dynamic",
            "arguments": {
                "query": query,
                "engine": engine,
                "maxResults": max_results,
                "format": format
            }
        }
    }
    
    print(f"🔍 Recherche et scraping pour: '{query}'")
    print(f"   Moteur: {engine}")
    print(f"   Max résultats: {max_results}")
    print(f"   Format: {format}")
    print("-" * 60)
    
    try:
        data = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(
            mcp_endpoint,
            data=data,
            headers={"Content-Type": "application/json"}
        )
        
        print("⏳ Envoi de la requête (peut prendre jusqu'à 60 secondes)...")
        
        with urllib.request.urlopen(req, timeout=120) as response:
            result = json.loads(response.read().decode('utf-8'))
        
        if "result" in result and "content" in result["result"]:
            content = result["result"]["content"][0]["text"]
            
            if format == "yaml":
                # Pour YAML, on retourne le contenu tel quel
                return {
                    "success": True,
                    "format": "yaml",
                    "content": content,
                    "query": query,
                    "engine": engine
                }
            else:
                # Pour JSON, on parse le contenu
                try:
                    parsed_content = json.loads(content)
                    return {
                        "success": True,
                        "format": "json",
                        "content": parsed_content,
                        "query": query,
                        "engine": engine
                    }
                except json.JSONDecodeError:
                    return {
                        "success": True,
                        "format": "text",
                        "content": content,
                        "query": query,
                        "engine": engine
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
            "error": f"Erreur HTTP: {e.code} - {e.reason}"
        }
    except urllib.error.URLError as e:
        return {
            "success": False,
            "error": f"Erreur de connexion: {str(e)}"
        }
    except Exception as e:
        return {
            "success": False,
            "error": f"Erreur inattendue: {str(e)}"
        }

def save_product_results(results, query):
    """Sauvegarde les résultats dans le dossier data"""
    data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
    os.makedirs(data_dir, exist_ok=True)
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    query_slug = "".join(c if c.isalnum() or c in ['-', '_'] else '_' for c in query[:40])
    
    filename = f"product_search_{timestamp}_{query_slug}.json"
    filepath = os.path.join(data_dir, filename)
    
    # Ajouter métadonnées
    output = {
        "timestamp": datetime.now().isoformat(),
        "query": query,
        "results": results
    }
    
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    
    return filepath

def parse_yaml_results(yaml_content):
    """Parse basiquement les résultats YAML pour extraction"""
    pages = yaml_content.split("---\n")
    results = []
    
    for page in pages:
        if not page.strip():
            continue
            
        page_data = {}
        lines = page.split("\n")
        
        for line in lines:
            if line.startswith("url:"):
                page_data["url"] = line.replace("url:", "").strip()
            elif line.startswith("title:"):
                page_data["title"] = line.replace("title:", "").strip()
            elif "value:" in line and "price" not in line.lower():
                # Extraire les valeurs (sans les prix pour l'instant)
                value = line.split("value:", 1)[1].strip()
                if "product_data" not in page_data:
                    page_data["product_data"] = []
                page_data["product_data"].append(value)
            elif "price" in line.lower() and "value:" in line:
                # Extraire les prix
                price = line.split("value:", 1)[1].strip()
                if "prices" not in page_data:
                    page_data["prices"] = []
                page_data["prices"].append(price)
        
        if page_data and "url" in page_data:
            results.append(page_data)
    
    return results

def main():
    """Fonction principale"""
    
    # Configuration
    query = "iphone 7 pro max 1To Orange Cosmic France"
    base_url = "http://localhost:3000"
    
    print("🚀 Test de search_and_scrape_dynamic pour MCP Cheerio")
    print("=" * 60)
    
    # Test avec différents moteurs
    engines = ["duckduckgo"]  # Vous pouvez ajouter "google", "bing"
    
    all_results = {}
    
    for engine in engines:
        print(f"\n📌 Test avec {engine}")
        print("-" * 60)
        
        # Recherche et scraping
        results = search_and_scrape_dynamic(
            query=query,
            engine=engine,
            max_results=3,  # Limiter à 3 pour le test
            format="yaml",
            base_url=base_url
        )
        
        if results["success"]:
            print(f"✅ Succès avec {engine}")
            
            if results["format"] == "yaml":
                # Parser les résultats YAML
                parsed = parse_yaml_results(results["content"])
                print(f"📦 {len(parsed)} page(s) scrapée(s)")
                
                for i, page in enumerate(parsed, 1):
                    print(f"\n  Page {i}:")
                    print(f"    📍 URL: {page.get('url', 'N/A')[:60]}...")
                    print(f"    📝 Titre: {page.get('title', 'N/A')[:60]}...")
                    if "prices" in page and page["prices"]:
                        print(f"    💰 Prix trouvés: {', '.join(page['prices'][:3])}")
                    if "product_data" in page and page["product_data"]:
                        print(f"    📊 Données: {len(page['product_data'])} éléments extraits")
                
                results["parsed"] = parsed
            
            # Afficher un extrait du contenu brut
            content_preview = results["content"][:500] if isinstance(results["content"], str) else str(results["content"])[:500]
            print(f"\n📄 Aperçu du contenu brut:")
            print(content_preview)
            print("..." if len(str(results["content"])) > 500 else "")
            
        else:
            print(f"❌ Échec avec {engine}: {results.get('error', 'Erreur inconnue')}")
        
        all_results[engine] = results
    
    # Sauvegarder tous les résultats
    filepath = save_product_results(all_results, query)
    print(f"\n💾 Résultats sauvegardés dans: {filepath}")
    
    # Résumé final
    print("\n" + "=" * 60)
    print("📊 RÉSUMÉ DES TESTS")
    print("=" * 60)
    
    success_count = sum(1 for r in all_results.values() if r.get("success"))
    total_count = len(all_results)
    
    print(f"✅ Réussis: {success_count}/{total_count}")
    print(f"❌ Échecs: {total_count - success_count}/{total_count}")
    
    # Compter le total de pages scrapées
    total_pages = 0
    for engine, result in all_results.items():
        if result.get("success") and "parsed" in result:
            pages = len(result["parsed"])
            total_pages += pages
            print(f"  • {engine}: {pages} page(s) scrapée(s)")
    
    print(f"\n📑 Total pages scrapées: {total_pages}")
    
    return all_results

if __name__ == "__main__":
    results = main()