# sheet.py <label> [group …]: one picture per group, the last screenshot of each question side by side.
import sys, glob, os, json
from PIL import Image, ImageDraw, ImageFont
here = os.path.dirname(os.path.abspath(__file__)); root = os.path.join(here, '..', '..', '..', 'artifacts', 'board-bench', sys.argv[1])
questions = json.load(open(os.path.join(here, 'questions.json')))['questions']
font = next((ImageFont.truetype(path, 30) for path in ('/System/Library/Fonts/PingFang.ttc', '/System/Library/Fonts/STHeiti Medium.ttc') if os.path.exists(path)), ImageFont.load_default())
for folder in sorted(glob.glob(os.path.join(root, '*/'))):
    group = os.path.basename(folder.rstrip('/'))
    if len(sys.argv) > 2 and group not in sys.argv[2:]: continue
    last = {}
    for name in sorted(glob.glob(os.path.join(folder, 'shot-*.png'))):
        last[os.path.basename(name)[8:-4]] = name
    last.pop('greeting', None)
    if not last: continue
    images = [(key, Image.open(name)) for key, name in last.items()]
    width, height = images[0][1].size
    sheet = Image.new('RGB', (len(images) * (width + 20), height + 60), '#ffffff'); pen = ImageDraw.Draw(sheet)
    for index, (key, image) in enumerate(images):
        pen.text((index * (width + 20) + 10, 10), f"{key}  {questions.get(key, {}).get('say', '')}"[:44], font=font, fill='#2a2030')
        sheet.paste(image, (index * (width + 20), 60))
    sheet.thumbnail((3200, 3200)); out = os.path.join(root, f'{group}.png'); sheet.save(out); print(out)
