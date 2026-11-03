"""Build public/words.txt from ENABLE (data/enable1.txt).

Keeps every word of 2 to 15 letters (lowercase a-z only), one per line.
Unlike Word Grid's builder, 2-letter words stay in and Q needs no U.
"""
import os, re

HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, "..", "data", "enable1.txt")) as f:
    words = sorted({w.strip().lower() for w in f if re.fullmatch(r"[a-z]{2,15}", w.strip().lower())})
with open(os.path.join(HERE, "..", "public", "words.txt"), "w") as f:
    f.write("\n".join(words))
print(len(words), "words")
