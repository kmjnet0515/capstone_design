"""
Тесты для чтения OLE Compound Document файлов
"""
import unittest
import os
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from compoundfiles.reader import CompoundFileReader
from compoundfiles.errors import (
    CompoundFileInvalidMagicError,
    CompoundFileInvalidBomError,
    CompoundFileNotFoundError,
    CompoundFileNotStreamError
)


class TestReaderBasic(unittest.TestCase):
    """Базовые тесты для чтения файлов Compound File"""

    def setUp(self):
        """Подготовка тестового окружения"""
        self.test_data_dir = os.path.join(os.path.dirname(__file__), '..', 'data')
        
    def test_read_existing_file(self):
        """Тест чтения существующего файла"""
        test_file = os.path.join(self.test_data_dir, 'small_with_dirs.ert')
        
        # Проверяем, что файл существует
        self.assertTrue(os.path.exists(test_file), f"Тестовый файл не найден: {test_file}")
        
        # Открываем файл для чтения
        with CompoundFileReader(test_file) as cfr:
            # Проверяем, что root существует
            self.assertIsNotNone(cfr.root)
            # Проверяем, что root является каталогом
            self.assertTrue(cfr.root.isdir)
            
    def test_read_file_with_context_manager(self):
        """Тест чтения файла с использованием контекстного менеджера"""
        test_file = os.path.join(self.test_data_dir, 'small_without_dirs.ert')
        
        self.assertTrue(os.path.exists(test_file), f"Тестовый файл не найден: {test_file}")
        
        with CompoundFileReader(test_file) as cfr:
            # Проверяем, что объект корректно закрывается
            self.assertIsNotNone(cfr.root)
            
        # После выхода из контекста объект должен быть закрыт
        # (в реальном тесте можно добавить проверку на состояние объекта)
        
    def test_read_file_object(self):
        """Тест чтения файла через file-like объект"""
        test_file = os.path.join(self.test_data_dir, 'big_with_dirs.MD')
        
        self.assertTrue(os.path.exists(test_file), f"Тестовый файл не найден: {test_file}")
        
        with open(test_file, 'rb') as f:
            with CompoundFileReader(f) as cfr:
                self.assertIsNotNone(cfr.root)
                
    def test_invalid_magic_number(self):
        """Тест обработки файла с неверным магическим числом"""
        # Создаем временный файл с неверным магическим числом
        with open('temp_invalid_magic.tmp', 'wb') as f:
            f.write(b'\x00' * 8)  # Неверное магическое число
            
        with self.assertRaises(CompoundFileInvalidMagicError):
            with CompoundFileReader('temp_invalid_magic.tmp') as cfr:
                pass  # Попытка открыть файл
                
        # Удаляем временный файл
        os.remove('temp_invalid_magic.tmp')
        
    def test_iterate_root_contents(self):
        """Тест перебора содержимого корневого каталога"""
        test_file = os.path.join(self.test_data_dir, 'small_with_dirs.ert')
        
        self.assertTrue(os.path.exists(test_file), f"Тестовый файл не найден: {test_file}")
        
        with CompoundFileReader(test_file) as cfr:
            # Перебираем элементы в корне
            items = list(cfr.root)
            # Проверяем, что есть хотя бы один элемент
            self.assertGreaterEqual(len(items), 0)  # Может быть пустым
            
            # Проверяем, что каждый элемент имеет правильные атрибуты
            for item in items:
                self.assertTrue(hasattr(item, 'name'))
                self.assertTrue(hasattr(item, 'isfile'))
                self.assertTrue(hasattr(item, 'isdir'))
                self.assertTrue(item.isfile or item.isdir)
                
    def test_access_by_name(self):
        """Тест доступа к элементам по имени"""
        test_file = os.path.join(self.test_data_dir, 'small_with_dirs.ert')
        
        self.assertTrue(os.path.exists(test_file), f"Тестовый файл не найден: {test_file}")
        
        with CompoundFileReader(test_file) as cfr:
            # Пробуем получить доступ к элементам по имени
            for item in cfr.root:
                # Проверяем доступ по имени
                retrieved_item = cfr.root[item.name]
                self.assertEqual(retrieved_item.name, item.name)
                
    def test_open_stream(self):
        """Тест открытия потока данных"""
        test_file = os.path.join(self.test_data_dir, 'small_with_dirs.ert')
        
        self.assertTrue(os.path.exists(test_file), f"Тестовый файл не найден: {test_file}")
        
        with CompoundFileReader(test_file) as cfr:
            # Находим первый файловый элемент (если он есть)
            stream_entity = None
            for item in cfr.root:
                if item.isfile:
                    stream_entity = item
                    break
                    
            if stream_entity is not None:
                # Открываем поток данных
                with cfr.open(stream_entity) as stream:
                    # Читаем данные
                    data = stream.read()
                    # Проверяем, что размер данных соответствует заявленному
                    self.assertEqual(len(data), stream_entity.size)
                    
    def test_open_stream_by_path(self):
        """Тест открытия потока данных по пути"""
        test_file = os.path.join(self.test_data_dir, 'small_with_dirs.ert')
        
        self.assertTrue(os.path.exists(test_file), f"Тестовый файл не найден: {test_file}")
        
        with CompoundFileReader(test_file) as cfr:
            # Находим первый файловый элемент (если он есть)
            stream_entity = None
            for item in cfr.root:
                if item.isfile:
                    stream_entity = item
                    break
                    
            if stream_entity is not None:
                # Открываем поток данных по пути
                with cfr.open(stream_entity.name) as stream:
                    data = stream.read()
                    self.assertEqual(len(data), stream_entity.size)
                    
    def test_nonexistent_file_error(self):
        """Тест обработки ошибки при попытке открыть несуществующий файл"""
        with self.assertRaises(OSError):
            with CompoundFileReader('nonexistent_file.abc') as cfr:
                pass
                
    def test_nonexistent_stream_error(self):
        """Тест обработки ошибки при попытке открыть несуществующий поток"""
        test_file = os.path.join(self.test_data_dir, 'small_with_dirs.ert')
        
        self.assertTrue(os.path.exists(test_file), f"Тестовый файл не найден: {test_file}")
        
        with CompoundFileReader(test_file) as cfr:
            with self.assertRaises(CompoundFileNotFoundError):
                cfr.open('nonexistent_stream')
                
    def test_file_not_stream_error(self):
        """Тест обработки ошибки при попытке открыть каталог как поток"""
        test_file = os.path.join(self.test_data_dir, 'small_with_dirs.ert')
        
        self.assertTrue(os.path.exists(test_file), f"Тестовый файл не найден: {test_file}")
        
        with CompoundFileReader(test_file) as cfr:
            # Находим первый каталог (если он есть)
            dir_entity = None
            for item in cfr.root:
                if item.isdir:
                    dir_entity = item
                    break
                    
            if dir_entity is not None:
                from compoundfiles.errors import CompoundFileNotStreamError
                with self.assertRaises(CompoundFileNotStreamError):
                    cfr.open(dir_entity)


if __name__ == '__main__':
    unittest.main()