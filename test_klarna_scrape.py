#!/usr/bin/env python3
"""
Script de test pour scrape_dynamic avec la page Klarna iPhone
"""

import json
import urllib.request
import urllib.error
from datetime import datetime
import os

def test_scrape_dynamic_klarna():
    """Teste scrape_dynamic avec la page Klarna iPhone"""
    
    base_url = "http://localhost:3000"
    mcp_endpoint = f"{base_url}/mcp"
    klarna_url = "https://www.klarna.com/fr/shopping/pl/cl1/3431242053/Telephones-portables/Apple-iPhone-17-Pro-Max-1TB-Cosmic-Orange/"
    
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {
            "name": "scrape_dynamic",
            "arguments": {
                "url": klarna_url,
                "format": "yaml",
                "flatten": True
            }
        }
    }
    
    print("🔍 Test scrape_dynamic avec Klarna")
    print("=" * 60)
    print(f"URL: {klarna_url}")
    print("Format: YAML")
    print("Flatten: True")
    print("-" * 60)
    print("⏳ Envoi de la requête (peut prendre jusqu'à 30 secondes)...")
    
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
            content = result["result"]["content"][0]["text"]
            
            print("✅ Scraping réussi!")
            print(f"📊 Données extraites: {len(content)} caractères")
            
            # Analyser le contenu YAML
            lines = content.split('\n')
            print(f"📄 {len(lines)} lignes extraites")
            
            # Extraire les informations clés
            product_name = ""
            price_info = []
            specs = []
            
            for line in lines:
                if "url:" in line:
                    continue
                elif "title:" in line:
                    product_name = line.replace("title:", "").strip()
                elif "label:" in line and "value:" in line:
                    # Extraire label et value de la même ligne
                    if "label: Nom du produit" in line:
                        value_part = line.split("value:")[1].strip() if "value:" in line else ""
                        if value_part:
                            product_name = value_part
                    elif any(keyword in line.lower() for keyword in ["prix", "price", "€", "$"]):
                        price_info.append(line.strip())
                    elif "label:" in line and "type: table" in line:
                        specs.append(line.strip())
                elif "prix le plus bas" in line.lower() or "€" in line:
                    price_info.append(line.strip())
            
            # Afficher le résumé
            print("\n📱 PRODUIT ANALYSÉ:")
            print(f"  Nom: {product_name}")
            
            print(f"\n📊 SPÉCIFICATIONS EXTRAITES: {len(specs)}")
            for spec in specs[:10]:  # Afficher les 10 premières
                if "label:" in spec:
                    try:
                        # Parser basiquement le YAML
                        parts = spec.split("value:")
                        if len(parts) >= 2:
                            label = parts[0].replace("label:", "").strip()
                            value = parts[1].split("type:")[0].strip()
                            print(f"  • {label}: {value}")
                    except:
                        print(f"  • {spec[:60]}...")
            
            if len(specs) > 10:
                print(f"  ... et {len(specs) - 10} autres spécifications")
            
            print(f"\n💰 INFORMATIONS PRIX: {len(price_info)}")
            for price in price_info[:5]:
                print(f"  • {price}")
            
            # Sauvegarder les résultats
            filepath = save_klarna_results(result, klarna_url)
            print(f"\n💾 Résultats sauvegardés dans: {filepath}")
            
            return {
                "success": True,
                "product_name": product_name,
                "specs_count": len(specs),
                "price_info_count": len(price_info),
                "total_lines": len(lines),
                "saved_file": filepath
            }
            
        else:
            print("❌ Erreur: Format de réponse invalide")
            return {
                "success": False,
                "error": "Invalid response format",
                "raw": result
            }
            
    except urllib.error.HTTPError as e:
        error_msg = f"Erreur HTTP: {e.code} - {e.reason}"
        print(f"❌ {error_msg}")
        return {"success": False, "error": error_msg}
        
    except urllib.error.URLError as e:
        error_msg = f"Erreur de connexion: {str(e)}"
        print(f"❌ {error_msg}")
        return {"success": False, "error": error_msg}
        
    except Exception as e:
        error_msg = f"Erreur inattendue: {str(e)}"
        print(f"❌ {error_msg}")
        return {"success": False, "error": error_msg}


def save_klarna_results(mcp_result, url):
    """Sauvegarde les résultats Klarna dans le dossier data"""
    
    # Créer le dossier data s'il n'existe pas
    data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
    os.makedirs(data_dir, exist_ok=True)
    
    # Créer le nom de fichier avec horodatage
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"klarna_scrape_dynamic_{timestamp}.json"
    filepath = os.path.join(data_dir, filename)
    
    # Préparer les données à sauvegarder
    output = {
        "timestamp": datetime.now().isoformat(),
        "test_type": "scrape_dynamic",
        "url": url,
        "mcp_response": mcp_result,
        "analysis": {
            "content_length": len(mcp_result["result"]["content"][0]["text"]) if "result" in mcp_result else 0,
            "lines_count": len(mcp_result["result"]["content"][0]["text"].split('\n')) if "result" in mcp_result else 0
        }
    }
    
    # Sauvegarder le fichier
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    
    return filepath


if __name__ == "__main__":
    print("🚀 Test scrape_dynamic - Page Klarna iPhone")
    print("=" * 60)
    
    result = test_scrape_dynamic_klarna()
    
    print("\n" + "=" * 60)
    print("📊 RÉSUMÉ DU TEST")
    print("=" * 60)
    
    if result["success"]:
        print("✅ Test réussi")
        print(f"  📱 Produit: {result['product_name']}")
        print(f"  📊 Spécifications: {result['specs_count']}")
        print(f"  💰 Infos prix: {result['price_info_count']}")
        print(f"  📄 Total lignes: {result['total_lines']}")
        print(f"  💾 Fichier: {result['saved_file']}")
    else:
        print("❌ Test échoué")
        print(f"  Erreur: {result.get('error', 'Erreur inconnue')}")
    
    print("\n🎯 scrape_dynamic est maintenant disponible dans le MCP!")