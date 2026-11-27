"""Static, data-minimized workflow failures suitable for API responses."""


class WorkflowFault(Exception):
    def __init__(self, code: str, message: str, status_code: int = 422, node: str | None = None):
        super().__init__(message)
        self.code, self.message, self.status_code, self.node = code, message, status_code, node
        self.workflow = None
