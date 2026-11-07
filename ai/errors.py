class EvaluationError(Exception):
    """A user-safe failure with the HTTP status and error code the evaluator returns."""

    def __init__(self, status: int, code: str, message: str):
        self.status = status
        self.code = code
        super().__init__(message)
