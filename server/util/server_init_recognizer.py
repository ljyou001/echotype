import time
import sherpa_onnx
from multiprocessing import Queue
import signal
from platform import system
from config import ServerConfig as Config
from config import ParaformerArgs, ModelPaths
from util.server_cosmic import console
from util.server_recognize import recognize
from util.empty_working_set import empty_current_working_set



def disable_jieba_debug():
    # Disable jieba's debug output
    import jieba
    import logging
    jieba.setLogLevel(logging.INFO)


def init_recognizer(queue_in: Queue, queue_out: Queue, sockets_id):

    # Allow exit with Ctrl-C
    signal.signal(signal.SIGINT, lambda signum, frame: exit())

    # Disable jieba debug output
    with console.status(_("Loading modules..."), spinner="bouncingBall", spinner_style="yellow"):
        import sherpa_onnx
        from funasr_onnx import CT_Transformer
        disable_jieba_debug()
    console.print(_('[green4]Modules loaded'), end='\n\n')
    queue_out.put({'stage': 'modules', 'status': 'done'})

    # Load speech model
    console.print(_('[yellow]Loading speech model...'), end='\r'); t1 = time.time()
    recognizer = sherpa_onnx.OfflineRecognizer.from_paraformer(
        **{key: value for key, value in ParaformerArgs.__dict__.items() if not key.startswith('_')}
    )
    console.print(_('[green4]Speech model loaded'), end='\n\n')
    queue_out.put({'stage': 'speech_model', 'status': 'done'})

    # Load punctuation model
    punc_model = None
    if Config.format_punc:
        console.print(_('[yellow]Loading punctuation model...'), end='\r')
        punc_model = CT_Transformer(ModelPaths.punc_model_dir, quantize=True)
        console.print(_('[green4]Punctuation model loaded'), end='\n\n')
        queue_out.put({'stage': 'punc_model', 'status': 'done'})
    else:
        queue_out.put({'stage': 'punc_model', 'status': 'skipped'})

    console.print(_('Model loading took {:.2f}s').format(time.time() - t1), end='\n\n')

    # Empty working set to reduce memory usage on Windows
    if system() == 'Windows':
        empty_current_working_set()

    queue_out.put({'stage': 'loaded', 'status': 'done'})

    while True:
        # Get task message from the queue
        # Block for a maximum of 1 second to allow for interruption
        try:
            task = queue_in.get(timeout=1)       
        except:
            continue

        if task.socket_id not in sockets_id:    # Check if the connection for the task is alive
            continue

        result = recognize(recognizer, punc_model, task)   # Perform recognition
        queue_out.put(result)      # Return result

