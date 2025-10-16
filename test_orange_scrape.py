#!/usr/bin/env python3
"""
Script de test pour scrape_dynamic avec la page Orange France iPhone
"""

import json
import urllib.request
import urllib.error
from datetime import datetime
import os

def test_scrape_dynamic_orange():
    """Teste scrape_dynamic avec la page Orange France iPhone"""
    
    base_url = "http://localhost:3000"
    mcp_endpoint = f"{base_url}/mcp"
    orange_url = "https://boutique.orange.fr/mobile/details/apple-iphone-17-pro-max-orange-cosmique-1to"
    
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {
            "name": "scrape_dynamic",
            "arguments": {
                "url": orange_url,
                "format": "yaml",
                "flatten": True
            }
        }
    }
    
    print("🍊 Test scrape_dynamic avec Orange France")
    print("=" * 60)
    print(f"URL: {orange_url}")
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
            images = []
            
            for line in lines:
                if "title:" in line:
                    product_name = line.replace("title:", "").strip()
                elif "type: price" in line:
                    price_info.append(line.strip())
                elif "label:" in line and "value:" in line and "type: table" in line:
                    specs.append(line.strip())
                elif "type: image" in line:
                    images.append(line.strip())
                elif "€" in line and "value:" in line:
                    price_info.append(line.strip())
            
            # Afficher le résumé
            print("\n📱 PRODUIT ANALYSÉ:")
            print(f"  Nom: {product_name}")
            
            print(f"\n💰 PRIX EXTRAITS: {len(price_info)}")
            for price in price_info[:10]:  # Afficher les 10 premiers
                if "value:" in price:
                    try:
                        value = price.split("value:")[1].split("type:")[0].strip()
                        print(f"  • {value}")
                    except:
                        print(f"  • {price[:80]}...")
            
            print(f"\n📊 SPÉCIFICATIONS: {len(specs)}")
            for spec in specs[:10]:  # Afficher les 10 premières
                if "label:" in spec:
                    try:
                        parts = spec.split("value:")
                        if len(parts) >= 2:
                            label = parts[0].replace("- label:", "").strip()
                            value = parts[1].split("type:")[0].strip()
                            print(f"  • {label}: {value}")
                    except:
                        print(f"  • {spec[:80]}...")
            
            if len(specs) > 10:
                print(f"  ... et {len(specs) - 10} autres spécifications")
            
            print(f"\n🖼️ IMAGES EXTRAITES: {len(images)}")
            for img in images[:5]:  # Afficher les 5 premières
                if "value:" in img:
                    try:
                        url = img.split("value:")[1].split("type:")[0].strip()
                        if url.startswith("http"):
                            print(f"  • {url[:60]}...")
                    except:
                        continue
            
            # Sauvegarder les résultats
            filepath = save_orange_results(result, orange_url)
            print(f"\n💾 Résultats sauvegardés dans: {filepath}")
            
            return {
                "success": True,
                "product_name": product_name,
                "specs_count": len(specs),
                "price_info_count": len(price_info),
                "images_count": len(images),
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


def save_orange_results(mcp_result, url):
    """Sauvegarde les résultats Orange dans le dossier data"""
    
    # Créer le dossier data s'il n'existe pas
    data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
    os.makedirs(data_dir, exist_ok=True)
    
    # Créer le nom de fichier avec horodatage
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"orange_scrape_dynamic_{timestamp}.json"
    filepath = os.path.join(data_dir, filename)
    
    # Préparer les données à sauvegarder
    output = {
        "timestamp": datetime.now().isoformat(),
        "test_type": "scrape_dynamic",
        "source": "orange_france",
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


def compare_with_klarna():
    """Compare les résultats Orange avec Klarna si disponible"""
    
    data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
    
    # Chercher le fichier Klarna le plus récent
    klarna_files = [f for f in os.listdir(data_dir) if f.startswith("klarna_scrape_dynamic_")]
    
    if not klarna_files:
        print("⚠️ Aucun fichier Klarna trouvé pour comparaison")
        return
    
    # Prendre le plus récent
    klarna_file = sorted(klarna_files)[-1]
    klarna_path = os.path.join(data_dir, klarna_file)
    
    try:
        with open(klarna_path, 'r', encoding='utf-8') as f:
            klarna_data = json.load(f)
        
        print(f"\n🔍 COMPARAISON AVEC KLARNA ({klarna_file}):")
        print("-" * 50)
        
        klarna_content = klarna_data["mcp_response"]["result"]["content"][0]["text"]
        klarna_lines = len(klarna_content.split('\n'))
        klarna_length = len(klarna_content)
        
        print(f"Klarna  : {klarna_lines:4d} lignes, {klarna_length:6d} caractères")
        print(f"Orange  : À comparer après extraction")
        
    except Exception as e:
        print(f"⚠️ Erreur lors de la lecture du fichier Klarna: {e}")


if __name__ == "__main__":
    print("🚀 Test scrape_dynamic - Page Orange France iPhone")
    print("=" * 60)
    
    result = test_scrape_dynamic_orange()
    
    print("\n" + "=" * 60)
    print("📊 RÉSUMÉ DU TEST ORANGE")
    print("=" * 60)
    
    if result["success"]:
        print("✅ Test réussi")
        print(f"  📱 Produit: {result['product_name']}")
        print(f"  📊 Spécifications: {result['specs_count']}")
        print(f"  💰 Infos prix: {result['price_info_count']}")
        print(f"  🖼️ Images: {result['images_count']}")
        print(f"  📄 Total lignes: {result['total_lines']}")
        print(f"  💾 Fichier: {result['saved_file']}")
        
        # Comparaison avec Klarna
        compare_with_klarna()
        
    else:
        print("❌ Test échoué")
        print(f"  Erreur: {result.get('error', 'Erreur inconnue')}")
    
    print("\n🎯 Test Orange France terminé!")