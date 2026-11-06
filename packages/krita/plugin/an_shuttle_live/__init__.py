from krita import Extension, Krita

from .krita_doc import KritaDocuments
from .server import ShuttleServer


class AnShuttleLive(Extension):
    def __init__(self, parent):
        super().__init__(parent)
        self.server = None

    def setup(self):
        self.server = ShuttleServer(KritaDocuments())
        self.server.start()

    def createActions(self, window):
        pass


Krita.instance().addExtension(AnShuttleLive(Krita.instance()))
