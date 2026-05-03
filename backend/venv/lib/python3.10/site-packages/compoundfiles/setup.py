from setuptools import setup, find_packages

setup(
    name="compoundfiles",
    version="0.1.0",
    packages=find_packages(),
    install_requires=[
        # Здесь можно указать зависимости, если они есть
    ],
    author="Dave Hughes, adapted by others",
    description="A library for reading Microsoft's OLE Compound Document format",
    python_requires='>=3.6',
)