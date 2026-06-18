import importlib.util, os, sys
from pathlib import Path
root=Path('/usr/local/lib/hermes-agent')
sys.path.insert(0,str(root))
spec=importlib.util.spec_from_file_location('p', root/'plugins/image_gen/openai-codex/__init__.py')
mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
os.environ['OPENAI_IMAGE_MODEL']='gpt-image-2-low'
provider=mod.OpenAICodexImageGenProvider()
print('available', provider.is_available(), flush=True)
for prompt in [
 'Generate a clear no-text instructional image of a person doing a plank exercise in a gym. No words, no labels.',
 'Create a fitness illustration: Romanian deadlift with barbell, correct form, modern gym, no text, no logos.',
]:
 r=provider.generate(prompt=prompt, aspect_ratio='landscape')
 print(r.get('success'), r.get('error'), r.get('image'), flush=True)
