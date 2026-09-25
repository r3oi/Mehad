import numpy as np, json
pts=np.load('work/skel.npy'); S=set((int(x),int(y)) for x,y in pts)
N8=[(dx,dy) for dx in (-1,0,1) for dy in (-1,0,1) if (dx,dy)!=(0,0)]
nb=lambda p:[(p[0]+dx,p[1]+dy) for dx,dy in N8 if (p[0]+dx,p[1]+dy) in S]
deg={p:len(nb(p)) for p in S}
special={p for p in S if deg[p]!=2}
# cluster specials (junction clusters within 3px)
clusters=[]
for p in sorted(special):
    for c in clusters:
        if any(abs(p[0]-q[0])<=3 and abs(p[1]-q[1])<=3 for q in c): c.append(p); break
    else: clusters.append([p])
# merge clusters transitively
changed=True
while changed:
    changed=False
    for i in range(len(clusters)):
        for j in range(i+1,len(clusters)):
            if any(abs(p[0]-q[0])<=3 and abs(p[1]-q[1])<=3 for p in clusters[i] for q in clusters[j]):
                clusters[i]+=clusters.pop(j); changed=True; break
        if changed: break
node_of={}
for i,c in enumerate(clusters):
    for p in c: node_of[p]=i
    cx=sum(p[0] for p in c)/len(c); cy=sum(p[1] for p in c)/len(c)
    print('node',i,(round(cx),round(cy)),'size',len(c))
edges=[]; seen=set()
for i,c in enumerate(clusters):
    for p in c:
        for q in nb(p):
            if q in node_of: continue
            if (p,q) in seen: continue
            chain=[p,q]; prev=p; cur=q
            while cur not in node_of:
                nxt=[r for r in nb(cur) if r!=prev and r not in chain[-3:]]
                if not nxt: break
                prev,cur=cur,nxt[0]; chain.append(cur)
            seen.add((chain[-1],chain[-2])); seen.add((p,q))
            j=node_of.get(chain[-1],-1)
            edges.append({'a':i,'b':j,'pts':chain})
# dedupe edges (same endpoints and similar length)
uniq=[]
for e in edges:
    if any(((u['a'],u['b'])==(e['b'],e['a']) or (u['a'],u['b'])==(e['a'],e['b'])) and abs(len(u['pts'])-len(e['pts']))<6 and (u['pts'][len(u['pts'])//2] in e['pts'] or u['pts'][len(u['pts'])//2] in set(e['pts'][::-1])) for u in uniq): continue
    if len(e['pts'])<4 and e['a']==e['b']: continue
    uniq.append(e)
for k,e in enumerate(uniq):
    m=e['pts'][len(e['pts'])//2]
    print('edge',k,e['a'],'->',e['b'],'len',len(e['pts']),'start',e['pts'][0],'mid',m,'end',e['pts'][-1])
json.dump({'nodes':[[round(sum(p[0] for p in c)/len(c)),round(sum(p[1] for p in c)/len(c))] for c in clusters],'edges':uniq},open('work/graph.json','w'))
