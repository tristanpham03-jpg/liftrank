# Renders the LiftRank app icons (three bars, the middle one lime) into public/icons.
from PIL import Image, ImageDraw
import os
os.makedirs("public/icons", exist_ok=True)
BG=(15,19,29); LIME=(243,244,248); GREY=(125,133,152); LIGHT=(181,160,255)
def icon(size, pad=0.18, round_bg=False):
    s=size*4
    im=Image.new("RGBA",(s,s),BG+(255,))
    d=ImageDraw.Draw(im)
    inner=s*(1-2*pad); x0=s*pad; y0=s*pad
    u=inner/24
    for (x,y,w,h,c) in [(2,12,5.5,10,GREY),(9.25,3,5.5,19,LIME),(16.5,8,5.5,14,LIGHT)]:
        d.rounded_rectangle([x0+x*u,y0+y*u,x0+(x+w)*u,y0+(y+h)*u],radius=1.5*u,fill=c)
    return im.resize((size,size),Image.LANCZOS)
icon(192).save("public/icons/icon-192.png")
icon(512).save("public/icons/icon-512.png")
icon(512,pad=0.26).save("public/icons/maskable-512.png")
icon(180,pad=0.2).save("src/app/apple-icon.png")
icon(48,pad=0.1).save("src/app/icon.png")
print("ok")
