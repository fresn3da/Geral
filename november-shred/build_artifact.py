"""Monta november-shred-artifact.html (página única para o claude.ai).

Os vídeos de demonstração no claude.ai ficam no armazenamento de arquivos da página;
clips_artifact.json mapeia id do exercício -> endereço desse arquivo.
"""
import json, os, re

here = os.path.dirname(os.path.abspath(__file__))
rd = lambda f: open(os.path.join(here, f), encoding="utf-8").read()
css, data, app = rd("styles.css"), rd("data.js"), rd("app.js")
clips_path = os.path.join(here, "clips_artifact.json")
clips = json.load(open(clips_path)) if os.path.exists(clips_path) else {}
data = re.sub(r"const CLIPS = \{.*?\};", "const CLIPS = " + json.dumps(clips, indent=2) + ";", data, flags=re.S)
body = rd("index.html").split("<body>")[1].split("<script")[0]
page = f"""<title>November Shred</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
<style>
{css}
</style>
{body}
<script>
{data}
</script>
<script>
{app}
</script>
"""
open(os.path.join(here, "november-shred-artifact.html"), "w", encoding="utf-8").write(page)
print("ok", len(clips), "clips")
