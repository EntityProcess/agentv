```python
def fizzbuzz(n=100):
    for i in range(1, n + 1):
        if i % 15 == 0:
            yield "fizzbuzz"
        elif i % 3 == 0:
            yield "fizz"
        elif i % 5 == 0:
            yield "buzz"
        else:
            yield str(i)

if __name__ == "__main__":
    for value in fizzbuzz(100):
        print(value)
```