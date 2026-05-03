"""
Главный модуль для запуска всех тестов для библиотеки compoundfiles
"""
import unittest
import os
import sys


def create_test_suite():
    """Создает тестовый набор из всех тестов в папке tests"""
    loader = unittest.TestLoader()
    start_dir = os.path.dirname(__file__)
    suite = loader.discover(start_dir, pattern='test_*.py')
    return suite

def run_tests():
    """Запускает все тесты"""
    suite = create_test_suite()
    
    # Создаем тест-раннер
    runner = unittest.TextTestRunner(
        verbosity=2,
        stream=sys.stdout,
        buffer=True  # Буферизация вывода тестов
    )
    
    # Запускаем тесты
    result = runner.run(suite)
    
    # Возвращаем результат (для возможного использования в CI/CD)
    return result.wasSuccessful()

if __name__ == '__main__':
    success = run_tests()
    sys.exit(0 if success else 1)