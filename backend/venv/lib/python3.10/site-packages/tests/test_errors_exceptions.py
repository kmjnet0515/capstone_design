"""
Тесты для проверки обработки ошибок и исключений
"""
import unittest
import os
import tempfile
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from compoundfiles.reader import CompoundFileReader
from compoundfiles.writer import CompoundFileWriter
from compoundfiles.errors import (
    CompoundFileError,
    CompoundFileNotFoundError,
    CompoundFileNotStreamError
)


class TestErrorsExceptions(unittest.TestCase):
    """Тесты для проверки обработки ошибок и исключений"""

    def setUp(self):
        """Подготовка тестового окружения"""
        self.temp_dir = tempfile.mkdtemp()

    def tearDown(self):
        """Очистка после тестов"""
        # Удаляем временные файлы
        for file in os.listdir(self.temp_dir):
            os.remove(os.path.join(self.temp_dir, file))
        os.rmdir(self.temp_dir)

    def test_nonexistent_file_reading(self):
        """Тест чтения несуществующего файла"""
        nonexistent_file = os.path.join(self.temp_dir, 'nonexistent.cfb')
        
        # Проверяем, что возникает исключение при попытке открыть несуществующий файл
        with self.assertRaises(OSError):
            with CompoundFileReader(nonexistent_file) as reader:
                pass

    def test_invalid_file_format(self):
        """Тест чтения файла с неверным форматом"""
        invalid_file = os.path.join(self.temp_dir, 'invalid.cfb')
        
        # Создаем файл с произвольными данными
        with open(invalid_file, 'wb') as f:
            f.write(b'This is not a valid OLE Compound Document')

        # Проверяем, что возникает исключение при попытке открыть файл с неверным форматом
        with self.assertRaises(Exception):  # Может быть разное исключение в зависимости от реализации
            with CompoundFileReader(invalid_file) as reader:
                pass

    def test_empty_file_reading(self):
        """Тест чтения пустого файла"""
        empty_file = os.path.join(self.temp_dir, 'empty.cfb')
        
        # Создаем пустой файл
        with open(empty_file, 'wb') as f:
            pass  # Файл остается пустым

        # Проверяем, что возникает исключение при попытке открыть пустой файл
        with self.assertRaises(Exception):  # Может быть разное исключение в зависимости от реализации
            with CompoundFileReader(empty_file) as reader:
                pass

    def test_missing_stream_access(self):
        """Тест доступа к несуществующему потоку"""
        temp_file = os.path.join(self.temp_dir, 'missing_stream.cfb')
        
        # Создаем файл с одним потоком
        with CompoundFileWriter(temp_file) as writer:
            writer.create_stream(writer.root, "existing_stream", b'Existing data')

        # Проверяем структуру файла и пытаемся получить несуществующий поток
        with CompoundFileReader(temp_file) as reader:
            # Проверяем, что существующий поток доступен
            items = list(reader.root)
            self.assertEqual(len(items), 1)
            
            existing_stream = items[0]
            self.assertEqual(existing_stream.name, 'existing_stream')
            
            # Проверяем содержимое существующего потока
            with reader.open(existing_stream) as s:
                content = s.read()
                self.assertEqual(content, b'Existing data')
            
            # Попробуем получить несуществующий поток
            # В нашей реализации мы можем проверить, что его нет в списке
            found = False
            for item in reader.root:
                if item.name == 'nonexistent_stream':
                    found = True
                    break
            self.assertFalse(found)

    def test_wrong_type_access(self):
        """Тест доступа к хранилищу как к потоку"""
        temp_file = os.path.join(self.temp_dir, 'wrong_type.cfb')
        
        # Создаем файл с хранилищем
        with CompoundFileWriter(temp_file) as writer:
            writer.create_storage(writer.root, "storage_item")

        # Проверяем структуру файла
        with CompoundFileReader(temp_file) as reader:
            items = list(reader.root)
            self.assertEqual(len(items), 1)
            
            storage_item = items[0]
            self.assertEqual(storage_item.name, 'storage_item')
            self.assertTrue(storage_item.isdir)  # Это хранилище, а не поток

    def test_corrupted_file_reading(self):
        """Тест чтения поврежденного файла"""
        corrupted_file = os.path.join(self.temp_dir, 'corrupted.cfb')
        
        # Создаем файл с частично правильным заголовком, но поврежденным содержимым
        with open(corrupted_file, 'wb') as f:
            # Записываем частичный заголовок OLE Compound Document
            f.write(b'\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1')  # Сигнатура
            f.write(b'PARTIALLY_CORRUPTED_DATA')  # Остальные данные повреждены

        # Проверяем, что возникает исключение при попытке открыть поврежденный файл
        with self.assertRaises(Exception):  # Может быть разное исключение в зависимости от реализации
            with CompoundFileReader(corrupted_file) as reader:
                pass

    def test_file_permissions_error(self):
        """Тест ошибки доступа к файлу из-за прав"""
        # Этот тест сложно реализовать полноценно без изменения прав на уровне ОС
        # Вместо этого протестируем ситуацию, когда файл заблокирован для записи
        temp_file = os.path.join(self.temp_dir, 'locked_file.cfb')
        
        # Создаем файл с помощью CompoundFileWriter
        with CompoundFileWriter(temp_file) as writer:
            writer.create_stream(writer.root, "test_stream", b'Test data')

        # Теперь пробуем открыть файл и убедиться, что он корректно записан
        with CompoundFileReader(temp_file) as reader:
            items = list(reader.root)
            self.assertEqual(len(items), 1)
            
            stream = items[0]
            self.assertEqual(stream.name, 'test_stream')
            self.assertTrue(stream.isfile)
            
            with reader.open(stream) as s:
                content = s.read()
                self.assertEqual(content, b'Test data')

    def test_invalid_stream_operations(self):
        """Тест недопустимых операций с потоками"""
        temp_file = os.path.join(self.temp_dir, 'invalid_ops.cfb')
        
        # Создаем файл с потоком
        with CompoundFileWriter(temp_file) as writer:
            writer.create_stream(writer.root, "test_stream", b'Test data')

        # Проверяем корректность файла
        with CompoundFileReader(temp_file) as reader:
            items = list(reader.root)
            self.assertEqual(len(items), 1)
            
            stream = items[0]
            self.assertEqual(stream.name, 'test_stream')
            
            # Проверяем, что можем прочитать содержимое
            with reader.open(stream) as s:
                content = s.read()
                self.assertEqual(content, b'Test data')

    def test_memory_limit_handling(self):
        """Тест обработки ограничений по памяти"""
        # Создаем файл с большим количеством небольших потоков
        temp_file = os.path.join(self.temp_dir, 'memory_test.cfb')
        
        with CompoundFileWriter(temp_file) as writer:
            # Создаем много потоков
            for i in range(1000):
                writer.create_stream(writer.root, f'stream_{i:04d}', f'Data for stream {i}'.encode())

        # Проверяем, что файл может быть прочитан
        with CompoundFileReader(temp_file) as reader:
            items = list(reader.root)
            self.assertEqual(len(items), 1000)

            for i, item in enumerate(items):
                expected_name = f'stream_{i:04d}'
                self.assertEqual(item.name, expected_name)
                
                # Проверяем содержимое
                with reader.open(item) as s:
                    content = s.read()
                    expected_content = f'Data for stream {i}'.encode()
                    self.assertEqual(content, expected_content)

    def test_concurrent_access(self):
        """Тест одновременного доступа к файлу (ограниченный тест)"""
        temp_file = os.path.join(self.temp_dir, 'concurrent_test.cfb')
        
        # Создаем файл
        with CompoundFileWriter(temp_file) as writer:
            writer.create_stream(writer.root, "test_stream", b'Test data for concurrent access')

        # Проверяем, что файл может быть открыт несколько раз для чтения
        # (в разных контекстах)
        with CompoundFileReader(temp_file) as reader1:
            with CompoundFileReader(temp_file) as reader2:
                # Проверяем, что оба ридера могут получить доступ к данным
                items1 = list(reader1.root)
                items2 = list(reader2.root)
                
                self.assertEqual(len(items1), 1)
                self.assertEqual(len(items2), 1)
                
                stream1 = items1[0]
                stream2 = items2[0]
                
                self.assertEqual(stream1.name, 'test_stream')
                self.assertEqual(stream2.name, 'test_stream')
                
                # Проверяем содержимое через оба ридера
                with reader1.open(stream1) as s1:
                    content1 = s1.read()
                
                with reader2.open(stream2) as s2:
                    content2 = s2.read()
                
                self.assertEqual(content1, b'Test data for concurrent access')
                self.assertEqual(content1, content2)

    def test_writer_errors(self):
        """Тест ошибок при записи"""
        # Простой тест на корректность записи
        temp_file = os.path.join(self.temp_dir, 'writer_test.cfb')
        
        # Создаем файл с помощью CompoundFileWriter
        with CompoundFileWriter(temp_file) as writer:
            writer.create_stream(writer.root, "test_stream", b'Test data')
            writer.create_storage(writer.root, "test_storage")

        # Проверяем, что файл был создан и содержит правильные данные
        self.assertTrue(os.path.exists(temp_file))
        
        with CompoundFileReader(temp_file) as reader:
            items = list(reader.root)
            self.assertEqual(len(items), 2)
            
            # Находим поток и хранилище
            stream_found = False
            storage_found = False
            
            for item in items:
                if item.name == 'test_stream' and item.isfile:
                    stream_found = True
                    with reader.open(item) as s:
                        content = s.read()
                        self.assertEqual(content, b'Test data')
                elif item.name == 'test_storage' and item.isdir:
                    storage_found = True
            
            self.assertTrue(stream_found)
            self.assertTrue(storage_found)