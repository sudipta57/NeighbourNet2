"""
NeighbourNet — Anchor Vector Generator
Run once on your machine to generate anchor_vectors.json
Requires: pip install sentence-transformers numpy
"""

import json
import numpy as np
from sentence_transformers import SentenceTransformer

MODEL_NAME = "paraphrase-multilingual-MiniLM-L12-v2"

ANCHORS = {
    "CRITICAL": [
        "I am trapped and cannot move, need immediate rescue",
        "Medical emergency, person is unconscious and needs help now",
        "Child stuck on roof, water is rising very fast, critical danger",
        "Elderly person cannot walk or move, need boat immediately",
        "We are trapped under debris, life threatening situation",
        "আমরা আটকে পড়েছি, সাহায্য দরকার এখনই",
        "আমি নড়তে পারছি না, তাৎক্ষণিক উদ্ধার দরকার",
        "বাচ্চা ছাদে আটকে আছে, জল উঠছে, এখনই সাহায্য চাই",
        "বৃদ্ধ মানুষ হাঁটতে পারছেন না, নৌকা দরকার",
        "ami atke gechi, ekhoni sahajjo chai",
        "emergency help needed immediately life at risk"
    ],
    "HIGH": [
        "Family is stranded, food and water will run out within 24 hours",
        "Water is rising steadily, we need rescue within a few hours",
        "Stuck on rooftop with elderly parents, supplies running low",
        "We have young children with us, need help before nightfall",
        "No food or clean water, situation getting worse",
        "আমাদের খাবার ও জল শেষ হয়ে আসছে, সাহায্য দরকার",
        "পরিবার আটকে আছে, ২৪ ঘণ্টার মধ্যে সাহায্য দরকার",
        "জল বাড়ছে, আমরা ছাদে আছি",
        "amar parivaar atke ache, khabar nei"
    ],
    "MEDIUM": [
        "We are stranded but currently safe, need supplies within two days",
        "Stuck in place but stable, food for one more day",
        "Need drinking water and food but not in immediate danger",
        "Isolated but okay for now, please send help when possible",
        "আমরা আটকে আছি কিন্তু এখনই বিপদ নেই, দু দিনের মধ্যে সাহায্য দরকার",
        "খাবার আছে কিছুটা, এখনই জরুরি নয় কিন্তু সাহায্য দরকার"
    ],
    "LOW": [
        "I am safe and doing okay, just checking in",
        "No emergency, reporting my location for coordination",
        "Offering help to neighbours, I am fine",
        "Safe at home, no issues, just updating status",
        "আমি ঠিক আছি, শুধু জানাচ্ছি",
        "কোনো সমস্যা নেই, অবস্থান জানাচ্ছি",
        "ami thik achi, kono emergency nei"
    ]
}


def compute_anchor_vectors():
    print(f"Loading model: {MODEL_NAME}")
    model = SentenceTransformer(MODEL_NAME)

    anchor_vectors = {}
    for tier, sentences in ANCHORS.items():
        print(f"Embedding {len(sentences)} sentences for tier: {tier}")
        embeddings = model.encode(sentences, normalize_embeddings=True)
        mean_vector = np.mean(embeddings, axis=0)
        # Normalize the mean vector
        norm = np.linalg.norm(mean_vector)
        if norm > 0:
            mean_vector = mean_vector / norm
        anchor_vectors[tier] = mean_vector.tolist()
        print(f"  Done. Vector dim: {len(anchor_vectors[tier])}")

    output = {
        "model": MODEL_NAME,
        "dim": 384,
        "tiers": list(anchor_vectors.keys()),
        "vectors": anchor_vectors
    }

    with open("assets/anchor_vectors.json", "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print("\nSaved to assets/anchor_vectors.json")
    print("Vector shapes:")
    for tier, vec in anchor_vectors.items():
        print(f"  {tier}: {len(vec)} dimensions")


if __name__ == "__main__":
    compute_anchor_vectors()