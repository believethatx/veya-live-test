from PIL import Image, ImageDraw, ImageFilter
from pathlib import Path
import math
size=1024
img=Image.new('RGB',(size,size))
p=img.load()
for y in range(size):
 for x in range(size):
  d=min(1,math.hypot(x-340,y-265)/930)
  p[x,y]=(int(40-24*d),int(31-16*d),int(70-36*d))
light=Image.new('RGBA',(size,size),(0,0,0,0));draw=ImageDraw.Draw(light)
draw.ellipse((130,58,894,822),outline=(186,135,255,28),width=4)
draw.ellipse((224,152,800,728),outline=(186,135,255,38),width=3)
light=light.filter(ImageFilter.GaussianBlur(2));img=Image.alpha_composite(img.convert('RGBA'),light)
glow=Image.new('RGBA',(size,size),(0,0,0,0));g=ImageDraw.Draw(glow)
g.line([(252,326),(479,716),(772,278)],fill=(189,126,255,120),width=172,joint='curve')
glow=glow.filter(ImageFilter.GaussianBlur(45));img=Image.alpha_composite(img,glow)
art=Image.new('RGBA',(size,size),(0,0,0,0));d=ImageDraw.Draw(art)
# A rounded, open V makes the mark legible at home-screen size.
d.line([(262,317),(478,695)],fill=(240,227,255,255),width=119,joint='curve')
d.ellipse((202,257,322,377),fill=(240,227,255,255))
d.ellipse((418,635,538,755),fill=(240,227,255,255))
d.line([(478,695),(764,283)],fill=(172,120,246,255),width=119,joint='curve')
d.ellipse((704,223,824,343),fill=(172,120,246,255))
d.ellipse((418,635,538,755),fill=(172,120,246,255))
d.ellipse((726,200,865,339),fill=(253,110,165,255))
d.ellipse((763,237,829,303),fill=(255,209,227,255))
img=Image.alpha_composite(img,art).convert('RGB')
root=Path(__file__).resolve().parent.parent/'public'
for pixels,name in [(192,'icon-192.png'),(512,'icon-512.png'),(180,'apple-touch-icon.png')]:
 img.resize((pixels,pixels),Image.Resampling.LANCZOS).save(root/name,optimize=True)
