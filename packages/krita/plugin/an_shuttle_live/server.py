"""Local socket inside Krita. One newline-terminated JSON request per connection."""
import json
import os

try:
    from PyQt5.QtNetwork import QLocalServer
except ImportError:
    from PyQt6.QtNetwork import QLocalServer

from .core import MAX_REQUEST, handle


def default_socket():
    return os.environ.get("AN_SHUTTLE_KRITA_SOCKET") or os.path.join(os.path.expanduser("~"), ".an-shuttle", "krita.sock")


class ShuttleServer:
    def __init__(self, documents, path=None):
        self.documents = documents
        self.path = path or default_socket()
        self.server = QLocalServer()
        # Same-user processes are trusted, as elsewhere in an-shuttle; nobody else may connect.
        option = getattr(QLocalServer, "UserAccessOption", None)
        self.server.setSocketOptions(option if option is not None else QLocalServer.SocketOption.UserAccessOption)
        self.server.newConnection.connect(self._accept)

    def start(self):
        os.makedirs(os.path.dirname(self.path), mode=0o700, exist_ok=True)
        QLocalServer.removeServer(self.path)
        if not self.server.listen(self.path):
            raise RuntimeError("an-shuttle cannot listen on %s: %s" % (self.path, self.server.errorString()))

    def _accept(self):
        while self.server.hasPendingConnections():
            connection = self.server.nextPendingConnection()
            buffer, answered = bytearray(), []

            def ready(connection=connection, buffer=buffer, answered=answered):
                if answered:
                    return
                buffer.extend(bytes(connection.readAll()))
                if b"\n" not in buffer and len(buffer) <= MAX_REQUEST:
                    return
                line = bytes(buffer.split(b"\n", 1)[0]).decode("utf-8", "replace")
                answered.append(True)
                reply = handle(line, self.documents)
                connection.write((json.dumps(reply, ensure_ascii=False) + "\n").encode("utf-8"))
                connection.flush()
                connection.disconnectFromServer()

            connection.readyRead.connect(ready)
            connection.disconnected.connect(connection.deleteLater)
            if connection.bytesAvailable():
                ready()
