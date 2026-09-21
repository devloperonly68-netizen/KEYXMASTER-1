"""
Optional Railway helper.

The bot itself is JavaScript because the uploaded TeleBotHost export contains
JavaScript command files. Railway should normally use `npm start`, but this
file lets you start the same bot manually with: python3 main.py
"""

import os
import subprocess
import sys

root = os.path.dirname(os.path.abspath(__file__))
sys.exit(subprocess.call(["node", "main.js"], cwd=root))