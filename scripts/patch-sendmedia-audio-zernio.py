from pathlib import Path

p = Path('app/api/messages/sendMedia/route.ts')
if not p.exists():
    raise SystemExit('No existe app/api/messages/sendMedia/route.ts')

s = p.read_text()
original = s

old = "function getMediaType(mimeType: string): { type: 'image' | 'video' | 'document', subDir: string, preview: string, msgType: Message['messageType'] } {"
new = "function getMediaType(mimeType: string): { type: 'image' | 'video' | 'audio' | 'document', subDir: string, preview: string, msgType: Message['messageType'] } {"
s = s.replace(old, new)

needle = "    if (mimeType.startsWith('video/')) return { type: 'video', subDir: 'video', preview: '📹 Vídeo', msgType: 'videoMessage' };\n"
insert = needle + "    if (mimeType.startsWith('audio/')) return { type: 'audio', subDir: 'audio', preview: '🎙️ Audio', msgType: 'audioMessage' };\n"
if "mimeType.startsWith('audio/')" not in s and needle in s:
    s = s.replace(needle, insert)

# Si TypeScript se queja por Message['messageType'] y audioMessage no está en union, dejamos el valor como any.
s = s.replace("msgType: 'audioMessage'", "msgType: 'audioMessage' as any")

if s != original:
    p.write_text(s)
    print('OK patched sendMedia audio support')
else:
    print('No changes needed in sendMedia audio support')
