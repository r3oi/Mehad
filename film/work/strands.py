import json, numpy as np
from scipy.ndimage import distance_transform_edt
from PIL import Image
G=json.load(open('work/graph.json')); E=G['edges']
def e(k,rev=False):
    p=[tuple(x) for x in E[k]['pts']]; return p[::-1] if rev else p
loop=e(12); print('loop start dir', loop[0], loop[8], loop[-8])
# م loop: go up-right first (clockwise visually in image coords)
if loop[8][1] > loop[0][1]: loop=loop[::-1]
print('loop after', loop[0], loop[10])
knot = e(10)+e(9,True)+e(7,True)+e(3,True)+e(4)+e(6)+e(8,True)+e(7,True)+e(5,True)+e(4,True)+e(2,True)
# verify edge endpoints chain adjacency
def chk(seq):
    bad=[i for i in range(1,len(seq)) if abs(seq[i][0]-seq[i-1][0])>4 or abs(seq[i][1]-seq[i-1][1])>4]
    return bad
meem = loop + e(11,True)
alef = e(1,True)   # from J8 back to alef top
dal = e(0,True)
for n,s in [('meem',meem),('knot',knot),('alef',alef),('dal',dal)]:
    print(n,len(s),s[0],s[-1],'gaps',[(i,s[i-1],s[i]) for i in chk(s)][:5])
def smooth(s,w=4,step=1.0):
    a=np.array(s,float)
    k=np.ones(2*w+1)/(2*w+1)
    pad=np.vstack([np.repeat(a[:1],w,0),a,np.repeat(a[-1:],w,0)])
    sm=np.stack([np.convolve(pad[:,i],k,'valid') for i in range(2)],1)
    sm[0]=a[0]; sm[-1]=a[-1]
    d=np.r_[0,np.cumsum(np.hypot(*np.diff(sm,axis=0).T))]
    t=np.arange(0,d[-1],step)
    return np.stack([np.interp(t,d,sm[:,0]),np.interp(t,d,sm[:,1])],1).round(2).tolist(), float(d[-1])
out={}
for n,s in [('meem',meem),('knot',knot),('alef',alef),('dal',dal)]:
    pts,L=smooth(s); out[n]={'pts':pts,'len':L}; print(n,'len',round(L))
# stroke width
wm=np.array(Image.open('work/wordmark.png'))[...,3]>100
dt=distance_transform_edt(wm)
sk=np.load('work/skel.npy'); ws=[dt[y,x] for x,y in sk]
out['strokeW']=float(np.median(ws)*2); print('stroke width',out['strokeW'])
out['box']=[560,160]
json.dump(out,open('work/logo_strands.json','w'))
