FROM python:3.12-slim

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir pytest

WORKDIR /testbed

# Create a simple calculator module with a known bug
RUN printf 'def add(a, b):\n    return a - b  # BUG: should be a + b\n\ndef subtract(a, b):\n    return a - b\n' > calculator.py

# Create test file
RUN printf 'from calculator import add, subtract\n\ndef test_add():\n    assert add(2, 3) == 5\n    assert add(-1, 1) == 0\n\ndef test_subtract():\n    assert subtract(5, 3) == 2\n' > test_calculator.py

# Initialize git so patches can be applied
RUN git config --global user.email "test@test.com" && \
    git config --global user.name "Test" && \
    git init && git add . && git commit -m "initial"

# Copy grader into the image
COPY grader.py /grader.py

CMD ["bash"]
