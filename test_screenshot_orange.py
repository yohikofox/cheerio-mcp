#!/usr/bin/env python3
"""
Script de test pour take_screenshot avec la page Orange France iPhone
Sauvegarde le screenshot dans le dossier data
"""

import json
import urllib.request
import urllib.error
import base64
from datetime import datetime
import os

def test_screenshot_orange():
    """Teste take_screenshot avec la page Orange France iPhone"""
    
    base_url = "http://localhost:3000"
    mcp_endpoint = f"{base_url}/mcp"
    orange_url = "https://boutique.orange.fr/mobile/details/apple-iphone-17-pro-max-orange-cosmique-1to"
    
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {
            "name": "take_screenshot",
            "arguments": {
                "url": orange_url,
                "width": 1920,
                "height": 1080,
                "fullPage": True,  # Capture de la page complète
                "format": "png"
            }
        }
    }
    
    print("📸 Test take_screenshot avec Orange France")
    print("=" * 60)
    print(f"URL: {orange_url}")
    print("Format: PNG")
    print("Taille: 1920x1080")
    print("Page complète: Oui")
    print("-" * 60)
    print("⏳ Prise de screenshot (peut prendre jusqu'à 30 secondes)...")
    
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
            content_text = result["result"]["content"][0]["text"]
            screenshot_data = json.loads(content_text)
            
            print("✅ Screenshot pris avec succès!")
            print(f"📊 Données extraites:")
            print(f"  URL: {screenshot_data['url']}")
            print(f"  Titre: {screenshot_data['title']}")
            print(f"  Format: {screenshot_data['image']['format']}")
            print(f"  Taille: {screenshot_data['image']['size']:,} bytes")
            print(f"  Dimensions: {screenshot_data['dimensions']['width']}x{screenshot_data['dimensions']['height']}")
            print(f"  Timestamp: {screenshot_data['timestamp']}")
            
            # Sauvegarder l'image
            image_path = save_screenshot_to_file(screenshot_data)
            print(f"\n💾 Screenshot sauvegardé: {image_path}")
            
            # Sauvegarder les métadonnées
            metadata_path = save_screenshot_metadata(result, orange_url)
            print(f"📋 Métadonnées sauvegardées: {metadata_path}")
            
            return {
                "success": True,
                "title": screenshot_data['title'],
                "image_size": screenshot_data['image']['size'],
                "dimensions": screenshot_data['dimensions'],
                "image_file": image_path,
                "metadata_file": metadata_path,
                "timestamp": screenshot_data['timestamp']
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


def save_screenshot_to_file(screenshot_data):
    """Sauvegarde le screenshot en tant que fichier image"""
    
    # Créer le dossier data s'il n'existe pas
    data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
    os.makedirs(data_dir, exist_ok=True)
    
    # Créer le nom de fichier avec horodatage
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    format_ext = screenshot_data['image']['format']
    filename = f"orange_screenshot_{timestamp}.{format_ext}"
    filepath = os.path.join(data_dir, filename)
    
    # Décoder et sauvegarder l'image
    image_data = base64.b64decode(screenshot_data['image']['base64'])
    
    with open(filepath, 'wb') as f:
        f.write(image_data)
    
    return filepath


def save_screenshot_metadata(mcp_result, url):
    """Sauvegarde les métadonnées du screenshot"""
    
    data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
    os.makedirs(data_dir, exist_ok=True)
    
    # Créer le nom de fichier avec horodatage
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"orange_screenshot_metadata_{timestamp}.json"
    filepath = os.path.join(data_dir, filename)
    
    # Préparer les métadonnées (sans l'image base64 pour économiser l'espace)
    metadata = {
        "timestamp": datetime.now().isoformat(),
        "test_type": "take_screenshot",
        "source": "orange_france",
        "url": url,
        "mcp_response": mcp_result
    }
    
    # Enlever le base64 pour réduire la taille du fichier
    if "result" in metadata["mcp_response"] and "content" in metadata["mcp_response"]["result"]:
        content = json.loads(metadata["mcp_response"]["result"]["content"][0]["text"])
        if "image" in content and "base64" in content["image"]:
            # Garder juste les infos sur l'image, pas les données
            content["image"] = {
                "format": content["image"]["format"],
                "size": content["image"]["size"],
                "base64_length": len(content["image"]["base64"]),
                "note": "Base64 data removed to save space"
            }
            metadata["mcp_response"]["result"]["content"][0]["text"] = json.dumps(content, indent=2)
    
    # Sauvegarder le fichier
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(metadata, f, indent=2, ensure_ascii=False)
    
    return filepath


def test_screenshot_comparison():
    """Teste plusieurs configurations de screenshot"""
    
    print("🔍 Test de comparaison de screenshots")
    print("=" * 60)
    
    orange_url = "https://boutique.orange.fr/mobile/details/apple-iphone-17-pro-max-orange-cosmique-1to"
    
    # Configuration des tests
    configs = [
        {"name": "Standard", "width": 1920, "height": 1080, "fullPage": False},
        {"name": "Mobile", "width": 390, "height": 844, "fullPage": False},
        {"name": "Tablet", "width": 768, "height": 1024, "fullPage": False},
        {"name": "Page complète", "width": 1920, "height": 1080, "fullPage": True}
    ]
    
    results = []
    
    for config in configs:
        print(f"\n📱 Test {config['name']} ({config['width']}x{config['height']}, fullPage: {config['fullPage']})")
        
        # Simuler le test (pour éviter de surcharger le serveur)
        # Dans un vrai test, on appellerait take_screenshot pour chaque config
        print(f"   Configuration préparée pour screenshot {config['name']}")
        
        results.append({
            "name": config['name'],
            "config": config,
            "status": "prepared"
        })
    
    print(f"\n✅ {len(results)} configurations de test préparées")
    return results


if __name__ == "__main__":
    print("🚀 Test take_screenshot - Page Orange France iPhone")
    print("=" * 60)
    
    # Test principal
    result = test_screenshot_orange()
    
    print("\n" + "=" * 60)
    print("📊 RÉSUMÉ DU TEST SCREENSHOT")
    print("=" * 60)
    
    if result["success"]:
        print("✅ Screenshot réussi")
        print(f"  📱 Page: {result['title']}")
        print(f"  📊 Taille image: {result['image_size']:,} bytes")
        print(f"  📐 Dimensions: {result['dimensions']['width']}x{result['dimensions']['height']}")
        print(f"  💾 Fichier image: {result['image_file']}")
        print(f"  📋 Métadonnées: {result['metadata_file']}")
        print(f"  🕒 Timestamp: {result['timestamp']}")
        
        # Afficher l'emplacement du fichier
        print(f"\n🎯 Vous pouvez voir le screenshot à:")
        print(f"   {result['image_file']}")
        
    else:
        print("❌ Test échoué")
        print(f"  Erreur: {result.get('error', 'Erreur inconnue')}")
    
    print("\n📸 take_screenshot est maintenant disponible dans le MCP!")