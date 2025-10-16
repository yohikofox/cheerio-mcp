#!/usr/bin/env python3
"""
Script pour mettre en forme les données extraites d'Orange France
"""

import json
import os
from datetime import datetime

def format_orange_data():
    """Formate et structure les données Orange pour un affichage lisible"""
    
    # Charger les données Orange
    data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
    orange_file = "orange_scrape_dynamic_20251016_124620.json"
    orange_path = os.path.join(data_dir, orange_file)
    
    with open(orange_path, 'r', encoding='utf-8') as f:
        orange_data = json.load(f)
    
    content = orange_data["mcp_response"]["result"]["content"][0]["text"]
    lines = content.split('\n')
    
    # Structures pour organiser les données
    product_info = {}
    prices = []
    features = []
    images = []
    services = []
    technical_specs = []
    
    print("🍊 FORMATAGE DES DONNÉES ORANGE FRANCE")
    print("=" * 60)
    print(f"Source: {orange_data['url']}")
    print(f"Extraction: {orange_data['timestamp']}")
    print("-" * 60)
    
    # Parser le contenu YAML
    current_section = None
    
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        
        if line.startswith("url:"):
            product_info["url"] = line.replace("url:", "").strip()
        elif line.startswith("title:"):
            product_info["title"] = line.replace("title:", "").strip()
        elif line.startswith("- value:") or line.startswith("value:"):
            # Extraire la valeur
            value = line.replace("- value:", "").replace("value:", "").strip()
            
            # Chercher le type sur la ligne suivante
            type_line = ""
            label = ""
            if i + 1 < len(lines):
                next_line = lines[i + 1].strip()
                if next_line.startswith("type:"):
                    type_line = next_line.replace("type:", "").strip()
                    i += 1  # Skip la ligne type
            
            # Chercher un label éventuel sur la ligne précédente
            if i > 0:
                prev_line = lines[i - 1].strip()
                if prev_line.startswith("- label:") or prev_line.startswith("label:"):
                    label = prev_line.replace("- label:", "").replace("label:", "").strip()
            
            # Classifier les données
            if type_line == "price" or "€" in value:
                prices.append({
                    "label": label if label else "Prix",
                    "value": value,
                    "type": type_line if type_line else "price"
                })
            elif type_line == "image":
                if value.startswith("http"):
                    images.append({
                        "label": label if label else "Image produit",
                        "url": value
                    })
            elif type_line == "text" or not type_line:
                # Classifier le texte par contenu
                if any(keyword in value.lower() for keyword in ["iphone", "apple", "pro max", "cosmique", "17"]):
                    if len(value) < 80:
                        features.append(value)
                elif any(keyword in value.lower() for keyword in ["orange", "service", "garantie", "assurance", "livraison", "reprise"]):
                    services.append(value)
                elif any(keyword in value.lower() for keyword in ["ios", "5g", "caméra", "écran", "batterie", "mhz", "mp", "go"]):
                    technical_specs.append(value)
                elif "€" in value:
                    prices.append({
                        "label": "Prix détecté",
                        "value": value,
                        "type": "text"
                    })
        
        i += 1
    
    # Affichage formaté
    print("📱 INFORMATIONS PRODUIT")
    print("-" * 30)
    if "title" in product_info:
        title_clean = product_info["title"].replace("- Détails et prix du mobile sur orange.fr", "")
        print(f"Produit: {title_clean}")
    
    print(f"\n💰 PRIX ET FINANCEMENT ({len(prices)} éléments)")
    print("-" * 30)
    main_prices = []
    financing_info = []
    
    for price in prices:
        value = price["value"]
        if "€" in value and len(value) < 50:  # Prix principaux
            main_prices.append(value)
        else:  # Infos de financement
            financing_info.append(value)
    
    # Prix principaux
    print("Prix principaux:")
    for price in main_prices[:5]:
        print(f"  • {price}")
    
    # Informations de financement
    if financing_info:
        print("\nOptions de financement:")
        for info in financing_info[:3]:
            if len(info) < 100:
                print(f"  • {info}")
    
    print(f"\n🖼️ IMAGES PRODUIT ({len(images)} images)")
    print("-" * 30)
    for i, img in enumerate(images[:5], 1):
        print(f"  {i}. {img['label']}")
        print(f"     {img['url'][:60]}...")
    
    if len(images) > 5:
        print(f"  ... et {len(images) - 5} autres images")
    
    print(f"\n✨ CARACTÉRISTIQUES PRODUIT ({len(features)} éléments)")
    print("-" * 30)
    for feature in features[:10]:
        if len(feature) < 80:
            print(f"  • {feature}")
    
    print(f"\n🔧 SPÉCIFICATIONS TECHNIQUES ({len(technical_specs)} éléments)")
    print("-" * 30)
    for spec in technical_specs[:10]:
        if len(spec) < 100:
            print(f"  • {spec}")
    
    print(f"\n🛠️ SERVICES ORANGE ({len(services)} éléments)")
    print("-" * 30)
    for service in services[:8]:
        if len(service) < 120:
            print(f"  • {service}")
    
    # Créer une version structurée
    formatted_data = {
        "timestamp": datetime.now().isoformat(),
        "source": "orange_france_formatted",
        "product": {
            "name": title_clean if "title" in product_info else "Apple iPhone 17 Pro Max Orange cosmique 1To",
            "url": product_info.get("url", ""),
            "features": features[:10],
            "technical_specs": technical_specs[:10]
        },
        "pricing": {
            "main_prices": main_prices,
            "financing_options": financing_info[:5]
        },
        "media": {
            "images": images[:10]
        },
        "services": {
            "orange_services": services[:8]
        },
        "stats": {
            "total_prices": len(prices),
            "total_images": len(images),
            "total_features": len(features),
            "total_technical_specs": len(technical_specs),
            "total_services": len(services)
        }
    }
    
    # Sauvegarder la version formatée
    formatted_file = "orange_formatted_data.json"
    formatted_path = os.path.join(data_dir, formatted_file)
    
    with open(formatted_path, 'w', encoding='utf-8') as f:
        json.dump(formatted_data, f, indent=2, ensure_ascii=False)
    
    print(f"\n💾 DONNÉES FORMATÉES SAUVEGARDÉES")
    print("-" * 30)
    print(f"Fichier: {formatted_path}")
    print(f"Structure: {len(formatted_data)} sections principales")
    
    return formatted_data

if __name__ == "__main__":
    result = format_orange_data()
    
    print("\n🎯 RÉSUMÉ DU FORMATAGE")
    print("=" * 60)
    stats = result["stats"]
    print(f"✅ {stats['total_prices']} éléments de prix traités")
    print(f"✅ {stats['total_images']} images organisées")
    print(f"✅ {stats['total_features']} caractéristiques extraites")
    print(f"✅ {stats['total_technical_specs']} spécifications techniques")
    print(f"✅ {stats['total_services']} services Orange identifiés")
    print("\n🍊 Données Orange France formatées avec succès!")