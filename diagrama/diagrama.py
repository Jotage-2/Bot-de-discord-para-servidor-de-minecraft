from pathlib import Path
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch
from matplotlib.lines import Line2D

OUT = Path(__file__).resolve().parent
FIGSIZE = (19.2, 10.8)
DPI = 180

C = {
    'bg':'#F7F9FC','text':'#1F2937','muted':'#667085','border':'#CBD5E1',
    'discord':'#EEF2F6','render':'#F2EFFA','azure':'#EAF4FB','vm':'#F3F7FA',
    'white':'#FFFFFF','identity':'#F4F8FC','monitor':'#F4F6F8','manual':'#F7F7F7',
    'user':'#475467','render_ac':'#6B5AA6','azure_ac':'#2E7DAF',
    'identity_ac':'#3C7AA3','green':'#2F7D5B','gray':'#7A7A7A'
}

TXT = {
'en': {
    'title':'Cloud Infrastructure & Automation Architecture',
    'subtitle':'Remote service management using Azure, Node.js, Discord and Linux',
    'discord_sub':'User commands','users':'Discord Users','render_sub':'Bot hosting',
    'bot':'Node.js Discord Bot','bot_l1':'Node.js + discord.js','bot_l2':'Receives Discord commands',
    'secrets':'Secrets → Render Environment Variables','auto_sub':'HTTPS webhook orchestration',
    'runbooks':'Automation Runbooks','start':'START flow','stop':'STOP flow','restart':'RESTART flow',
    'start_steps':['START webhook → Start-MinecraftVM','VM starts → Ubuntu boots','minecraft.service → screen → Paper','Bot polls TCP 25565 → Server ready'],
    'stop_steps':['Stop-MinecraftVM','systemctl stop minecraft','Paper saves world','VM deallocated'],
    'restart_steps':['Discord confirmation','stop minecraft','reset-world.sh --force','start minecraft'],
    'identity':'System Assigned Managed Identity','role':'Virtual Machine Contributor • VM scope only',
    'nocreds':'No personal Azure credentials stored in bot','vm':'Azure VM / Ubuntu 24.04 LTS',
    'vm_sub':'2 vCPU  •  4 GB RAM  •  TCP 25565','runtime':'Service Runtime','screen_sub':'interactive console',
    'world':'World Management','world_lines':['reset-world.sh --force','Overworld / Nether / End','Paper generates new world'],
    'graceful':'Graceful Stop','graceful_lines':['systemctl stop minecraft','Paper saves world','Stopped (deallocated)'],
    'dealloc':'Deallocation minimizes\ncompute credit consumption','discord_flow':'Discord interactions','webhooks':'HTTPS Webhooks',
    'control':'Azure control plane','rbac':'Managed Identity / RBAC','health':'TCP health check :25565','health_note':'VM Running ≠ Minecraft Online',
    'developer':'Developer','github':'GitHub main','github_sub':'bot source code','autodeploy':'auto-deploy on commit',
    'uptime_sub':'HTTP GET / every 5 min','monitor':'Availability / keep-alive monitor','admin':'Administrator','admin_sub':'manual operations',
    'manual':'screen -r minecraft\nconsole • OP • plugins • config • logs','bootnote':'minecraft.service starts automatically with Ubuntu',
    'papernote':'Paper is online only when TCP 25565 is listening','legend':['HTTPS Webhook','TCP Health Check','SSH Administration','HTTP Monitoring']
},
'es': {
    'title':'Arquitectura de Infraestructura Cloud y Automatización',
    'subtitle':'Gestión remota de servicios con Azure, Node.js, Discord y Linux',
    'discord_sub':'Comandos de usuario','users':'Usuarios de Discord','render_sub':'Alojamiento del bot',
    'bot':'Bot de Discord en Node.js','bot_l1':'Node.js + discord.js','bot_l2':'Recibe comandos de Discord',
    'secrets':'Secretos → Variables de entorno en Render','auto_sub':'Orquestación mediante webhooks HTTPS',
    'runbooks':'Runbooks de automatización','start':'Flujo START','stop':'Flujo STOP','restart':'Flujo RESTART',
    'start_steps':['Webhook START → Start-MinecraftVM','La VM inicia → Ubuntu arranca','minecraft.service → screen → Paper','El bot consulta TCP 25565 → Servidor listo'],
    'stop_steps':['Stop-MinecraftVM','systemctl stop minecraft','Paper guarda el mundo','VM desasignada'],
    'restart_steps':['Confirmación en Discord','detener minecraft','reset-world.sh --force','iniciar minecraft'],
    'identity':'Identidad Administrada Asignada por Sistema','role':'Virtual Machine Contributor • solo sobre la VM',
    'nocreds':'El bot no almacena credenciales personales de Azure','vm':'VM de Azure / Ubuntu 24.04 LTS',
    'vm_sub':'2 vCPU  •  4 GB RAM  •  TCP 25565','runtime':'Ejecución del servicio','screen_sub':'consola interactiva',
    'world':'Gestión del mundo','world_lines':['reset-world.sh --force','Overworld / Nether / End','Paper genera un mundo nuevo'],
    'graceful':'Apagado seguro','graceful_lines':['systemctl stop minecraft','Paper guarda el mundo','Stopped (deallocated)'],
    'dealloc':'La desasignación reduce\nel consumo de créditos','discord_flow':'Interacción con Discord','webhooks':'Webhooks HTTPS',
    'control':'Plano de control de Azure','rbac':'Identidad Administrada / RBAC','health':'Comprobación TCP :25565','health_note':'VM encendida ≠ Minecraft online',
    'developer':'Desarrollador','github':'GitHub main','github_sub':'código fuente del bot','autodeploy':'auto-deploy por commit',
    'uptime_sub':'HTTP GET / cada 5 min','monitor':'Monitor de disponibilidad / keep-alive','admin':'Administrador','admin_sub':'operaciones manuales',
    'manual':'screen -r minecraft\nconsola • OP • plugins • config • logs','bootnote':'minecraft.service inicia automáticamente con Ubuntu',
    'papernote':'Paper está online solo cuando TCP 25565 está escuchando','legend':['Webhook HTTPS','Comprobación TCP','Administración SSH','Monitorización HTTP']
}}

def rounded(ax,x,y,w,h,fc,ec,lw=1.2,r=0.18,z=2):
    p=FancyBboxPatch((x,y),w,h,boxstyle=f'round,pad=0.012,rounding_size={r}',facecolor=fc,edgecolor=ec,linewidth=lw,zorder=z)
    ax.add_patch(p); return p

def container(ax,x,y,w,h,title,subtitle,fc,ec):
    rounded(ax,x,y,w,h,fc,ec,1.35,0.24,1)
    ax.text(x+.24,y+h-.28,title,fontsize=12,fontweight='bold',color=C['text'],va='top',zorder=3)
    if subtitle:
        ax.text(x+.24,y+h-.62,subtitle,fontsize=8.2,color=C['muted'],va='top',zorder=3)

def node(ax,x,y,w,h,title,lines=None,fc=None,ec=None,tc=None,ts=9.5,bs=7.0):
    rounded(ax,x,y,w,h,fc or C['white'],ec or C['border'],1.1,0.16,3)
    ax.text(x+w/2,y+h-.17,title,fontsize=ts,fontweight='bold',color=tc or C['text'],ha='center',va='top',zorder=4)
    if lines:
        if isinstance(lines,str): lines=[lines]
        ax.text(x+w/2,y+h-.52,'\n'.join(lines),fontsize=bs,color=C['muted'],ha='center',va='top',linespacing=1.35,zorder=4)

def label(ax,x,y,s,size=7.2,color=None,bg=True):
    bb=dict(boxstyle='round,pad=0.20',facecolor=C['bg'],edgecolor='none',alpha=.96) if bg else None
    ax.text(x,y,s,fontsize=size,color=color or C['muted'],ha='center',va='center',bbox=bb,zorder=8)

def arrow(ax,a,b,color,text=None,pos=None,ls='-',lw=1.6,rad=0):
    p=FancyArrowPatch(a,b,arrowstyle='-|>',mutation_scale=13,color=color,linewidth=lw,linestyle=ls,connectionstyle=f'arc3,rad={rad}',shrinkA=0,shrinkB=0,zorder=5)
    ax.add_patch(p)
    if text:
        if pos is None: pos=((a[0]+b[0])/2,(a[1]+b[1])/2)
        label(ax,*pos,text,color=color)

def seq(ax,x,y,w,h,title,steps):
    rounded(ax,x,y,w,h,C['white'],'#BBD8EA',1.0,0.14,3)
    ax.text(x+.16,y+h-.15,title,fontsize=8.0,fontweight='bold',color=C['text'],va='top',zorder=4)
    top=y+h-.40; bottom=y+.12
    gap=(top-bottom)/(len(steps)-1)
    bs=6.0 if w<3 else 6.25
    for i,step in enumerate(steps):
        ax.text(x+.17,top-i*gap,('→ ' if i else '')+step,fontsize=bs,color=C['muted'],va='top',zorder=4)

def build(lang):
    t=TXT[lang]
    fig,ax=plt.subplots(figsize=FIGSIZE,dpi=DPI)
    fig.patch.set_facecolor(C['bg']); ax.set_facecolor(C['bg']); ax.set_xlim(0,19.2); ax.set_ylim(0,10.8); ax.axis('off')
    ax.text(.72,10.34,t['title'],fontsize=22.5,fontweight='bold',color=C['text'],va='center')
    ax.text(.74,9.94,t['subtitle'],fontsize=10.3,color=C['muted'],va='center')

    container(ax,.55,3.62,2.20,3.95,'Discord',t['discord_sub'],C['discord'],C['border'])
    node(ax,.84,5.20,1.62,1.44,t['users'],['/start   /stop','/status   /restart','/comandos'],ts=9.2,bs=7.4)

    container(ax,3.05,3.36,3.05,4.35,'Render',t['render_sub'],C['render'],'#CFC5EA')
    node(ax,3.40,5.20,2.35,1.52,t['bot'],[t['bot_l1'],t['bot_l2']],ec='#CFC5EA',tc=C['render_ac'],ts=9.2)
    label(ax,4.58,4.62,t['secrets'],6.9,C['render_ac'],False)

    # Azure Automation: intentionally roomy. Header area is reserved and never covered.
    container(ax,6.55,2.48,5.30,6.10,'Azure Automation',t['auto_sub'],C['azure'],'#BBD8EA')
    node(ax,6.96,6.48,4.48,.98,t['runbooks'],['Start-MinecraftVM   •   Stop-MinecraftVM','Status-MinecraftVM   •   Restart-MinecraftWorld'],ec='#BBD8EA',tc=C['azure_ac'],ts=9.2,bs=6.7)
    seq(ax,6.96,4.80,4.48,1.30,t['start'],t['start_steps'])
    seq(ax,6.96,3.43,2.12,1.04,t['stop'],t['stop_steps'])
    seq(ax,9.32,3.43,2.12,1.04,t['restart'],t['restart_steps'])
    node(ax,6.96,2.78,4.48,.42,t['identity'],None,fc=C['identity'],ec='#B5CCD9',tc=C['identity_ac'],ts=7.3)
    label(ax,9.20,2.58,t['role'],6.3,C['identity_ac'],False)
    label(ax,9.20,2.39,t['nocreds'],6.5,C['identity_ac'],False)

    container(ax,12.25,2.20,6.35,6.25,t['vm'],t['vm_sub'],C['vm'],'#B9CDD9')
    container(ax,12.66,4.10,2.95,3.10,t['runtime'],'',C['white'],'#C8D4DD')
    node(ax,13.03,5.78,2.20,.76,'systemd',['minecraft.service'],ec='#C8D4DD',ts=8.9,bs=6.9)
    node(ax,13.03,4.86,2.20,.76,'screen',[t['screen_sub']],ec='#C8D4DD',ts=8.9,bs=6.9)
    node(ax,13.03,4.20,2.20,.52,'Java / Paper 26.2',ec='#B8CCD8',tc=C['azure_ac'],ts=8.6)
    arrow(ax,(14.13,5.78),(14.13,5.64),C['azure_ac'],lw=1.2)
    arrow(ax,(14.13,4.86),(14.13,4.74),C['azure_ac'],lw=1.2)
    node(ax,15.93,5.54,2.22,1.34,t['world'],t['world_lines'],ec='#C8D4DD',ts=8.6,bs=6.5)
    node(ax,15.93,3.74,2.22,1.30,t['graceful'],t['graceful_lines'],ec='#C8D4DD',ts=8.6,bs=6.5)
    label(ax,17.04,3.25,t['dealloc'],6.8,C['green'],False)

    arrow(ax,(2.46,5.94),(3.40,5.94),C['user'],t['discord_flow'],(2.93,6.30))
    arrow(ax,(5.75,6.02),(6.96,6.95),C['azure_ac'],t['webhooks'],(6.35,6.48))
    arrow(ax,(11.44,6.95),(12.66,6.95),C['azure_ac'],t['control'],(12.02,7.25),lw=1.8)
    arrow(ax,(11.44,2.99),(12.25,2.99),C['identity_ac'],t['rbac'],(11.84,3.25),lw=1.5)

    # Direct TCP check kept below orchestration to avoid crossing Azure Automation internals.
    ls=(0,(5,3))
    ax.add_line(Line2D([5.72,6.30],[5.42,2.06],color=C['green'],linewidth=1.4,linestyle=ls,zorder=5))
    ax.add_line(Line2D([6.30,11.92],[2.06,2.06],color=C['green'],linewidth=1.4,linestyle=ls,zorder=5))
    arrow(ax,(11.92,2.06),(13.12,4.44),C['green'],ls=ls,lw=1.4)
    label(ax,9.16,1.84,f"{t['health']}   •   {t['health_note']}",6.9,C['green'])

    node(ax,3.06,8.67,1.50,.72,t['developer'],['git push'],fc=C['manual'],ts=8.7,bs=6.7)
    node(ax,4.85,8.67,1.70,.72,t['github'],[t['github_sub']],fc=C['manual'],ts=8.7,bs=6.7)
    arrow(ax,(4.56,9.03),(4.85,9.03),C['gray'],lw=1.2)
    arrow(ax,(5.70,8.67),(5.10,7.71),C['render_ac'],t['autodeploy'],(5.93,8.18),lw=1.25,rad=.08)

    node(ax,3.20,1.20,2.20,.88,'UptimeRobot',[t['uptime_sub']],fc=C['monitor'],ts=9.0,bs=6.9)
    arrow(ax,(4.30,2.08),(4.30,3.36),C['gray'],t['monitor'],(5.14,2.66),ls=(0,(4,3)),lw=1.25)

    node(ax,12.36,.92,2.05,.80,t['admin'],[t['admin_sub']],fc=C['manual'],ts=8.7,bs=6.7)
    arrow(ax,(14.41,1.32),(15.20,2.20),C['gray'],'SSH',(14.82,1.72),ls=(0,(5,4)),lw=1.2)
    label(ax,16.50,1.35,t['manual'],6.7,C['gray'],False)
    label(ax,13.90,3.53,t['bootnote'],6.7,C['azure_ac'],False)
    label(ax,16.97,7.53,t['papernote'],6.8,C['muted'],False)

    ax.plot([.72,18.45],[.70,.70],color=C['border'],linewidth=.8)
    styles=[(C['azure_ac'],'-'),(C['green'],(0,(5,3))),(C['gray'],(0,(5,4))),(C['gray'],(0,(4,3)))]
    x=1.00
    for name,(col,ls2) in zip(t['legend'],styles):
        ax.add_line(Line2D([x,x+.52],[.42,.42],color=col,linewidth=1.9,linestyle=ls2))
        ax.text(x+.65,.42,name,fontsize=7.1,color=C['muted'],va='center')
        x+=4.25

    fn=OUT/('architecture_diagram_english_v2.png' if lang=='en' else 'architecture_diagram_espanol_v2.png')
    fig.savefig(fn,dpi=DPI,facecolor=fig.get_facecolor())
    plt.close(fig)
    return fn

if __name__=='__main__':
    build('en')
    build('es')
    print('Architecture diagrams generated successfully.')