"""
Расширенные тесты для проверки граничных случаев и сложных сценариев
"""
import unittest
import os
import tempfile
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from compoundfiles.reader import CompoundFileReader
from compoundfiles.writer import CompoundFileWriter
from compoundfiles.errors import (
    CompoundFileNotFoundError,
    CompoundFileNotStreamError
)


class TestEdgeCases(unittest.TestCase):
    """Тесты для проверки граничных случаев"""

    def setUp(self):
        """Подготовка тестового окружения"""
        self.temp_dir = tempfile.mkdtemp()

    def tearDown(self):
        """Очистка после тестов"""
        # Удаляем временные файлы
        for file in os.listdir(self.temp_dir):
            os.remove(os.path.join(self.temp_dir, file))
        os.rmdir(self.temp_dir)

    def test_deeply_nested_directories(self):
        """Тест глубоко вложенных каталогов"""
        temp_file = os.path.join(self.temp_dir, 'deep_nesting.cfb')

        depth = 10

        # Создаем файл с глубоко вложенными каталогами
        with CompoundFileWriter(temp_file) as writer:
            current_storage = writer.root
            for i in range(depth):
                current_storage = writer.create_storage(current_storage, f'level_{i}')

            # Добавляем поток в самый глубокий каталог
            writer.create_stream(current_storage, 'deep_stream', b'Deeply nested data')

        # Проверяем структуру файла
        with CompoundFileReader(temp_file) as reader:
            # Начинаем с корня и спускаемся вглубь
            current_item = reader.root
            items = list(current_item)
            current_item = items[0]  # level_0

            # Проходим по всем уровням
            for i in range(depth - 1):  # -1 потому что на последнем уровне будет поток
                self.assertTrue(current_item.isdir)
                self.assertEqual(current_item.name, f'level_{i}')
                
                items = list(current_item)
                self.assertEqual(len(items), 1)  # Только следующий уровень или поток
                
                current_item = items[0]

            # На последнем уровне должен быть поток
            self.assertTrue(current_item.isdir)
            self.assertEqual(current_item.name, f'level_{depth-1}')
            
            # Проверяем, что в нем есть поток
            final_items = list(current_item)
            self.assertEqual(len(final_items), 1)
            
            deep_stream = final_items[0]
            self.assertEqual(deep_stream.name, 'deep_stream')
            self.assertTrue(deep_stream.isfile)
            
            # Проверяем содержимое потока
            with reader.open(deep_stream) as s:
                content = s.read()
                self.assertEqual(content, b'Deeply nested data')

    def test_many_files_in_single_directory(self):
        """Тест множества файлов в одном каталоге"""
        temp_file = os.path.join(self.temp_dir, 'many_files.cfb')

        file_count = 100
        test_data = b'Test data for multiple files'

        # Создаем файл с множеством потоков в одном каталоге
        with CompoundFileWriter(temp_file) as writer:
            for i in range(file_count):
                writer.create_stream(writer.root, f'file_{i:03d}', test_data)

        # Проверяем структуру файла
        with CompoundFileReader(temp_file) as reader:
            items = list(reader.root)
            self.assertEqual(len(items), file_count)

            for i, item in enumerate(items):
                expected_name = f'file_{i:03d}'
                self.assertEqual(item.name, expected_name)
                self.assertTrue(item.isfile)

                # Проверяем содержимое
                with reader.open(item) as s:
                    content = s.read()
                    self.assertEqual(content, test_data)

    def test_many_directories_in_single_directory(self):
        """Тест множества каталогов в одном каталоге"""
        temp_file = os.path.join(self.temp_dir, 'many_directories.cfb')

        dir_count = 50

        # Создаем файл с множеством каталогов в одном каталоге
        with CompoundFileWriter(temp_file) as writer:
            for i in range(dir_count):
                writer.create_storage(writer.root, f'dir_{i:03d}')

        # Проверяем структуру файла
        with CompoundFileReader(temp_file) as reader:
            items = list(reader.root)
            self.assertEqual(len(items), dir_count)

            for i, item in enumerate(items):
                expected_name = f'dir_{i:03d}'
                self.assertEqual(item.name, expected_name)
                self.assertTrue(item.isdir)

    def test_alternating_streams_and_storages(self):
        """Тест чередования потоков и хранилищ"""
        temp_file = os.path.join(self.temp_dir, 'alternating.cfb')

        # Создаем файл с чередованием потоков и хранилищ
        with CompoundFileWriter(temp_file) as writer:
            for i in range(10):
                if i % 2 == 0:
                    # Четные индексы - потоки
                    writer.create_stream(writer.root, f'stream_{i}', f'Stream data {i}'.encode())
                else:
                    # Нечетные индексы - хранилища
                    writer.create_storage(writer.root, f'storage_{i}')

        # Проверяем структуру файла
        with CompoundFileReader(temp_file) as reader:
            items = list(reader.root)
            self.assertEqual(len(items), 10)

            # Создаем множества ожидаемых имен для проверки
            expected_streams = {f'stream_{i}' for i in range(10) if i % 2 == 0}
            expected_storages = {f'storage_{i}' for i in range(10) if i % 2 == 1}

            actual_streams = set()
            actual_storages = set()

            for item in items:
                if item.isfile:
                    actual_streams.add(item.name)
                    # Проверяем содержимое потока
                    with reader.open(item) as s:
                        content = s.read()
                        # Извлекаем индекс из имени потока
                        idx = int(item.name.split('_')[1])
                        self.assertEqual(content, f'Stream data {idx}'.encode())
                elif item.isdir:
                    actual_storages.add(item.name)

            # Проверяем, что все ожидаемые элементы присутствуют
            self.assertEqual(actual_streams, expected_streams)
            self.assertEqual(actual_storages, expected_storages)

    def test_extremely_long_filename(self):
        """Тест очень длинного имени файла"""
        temp_file = os.path.join(self.temp_dir, 'long_filename.cfb')

        # Максимальная длина имени в OLE Compound Document - 31 символ Unicode
        long_name = 'A' * 31  # 31 символ - максимальное разрешенное имя
        test_data = b'Long filename test data'

        # Создаем файл с очень длинным именем
        with CompoundFileWriter(temp_file) as writer:
            writer.create_stream(writer.root, long_name, test_data)

        # Проверяем структуру файла
        with CompoundFileReader(temp_file) as reader:
            items = list(reader.root)
            self.assertEqual(len(items), 1)

            item = items[0]
            self.assertEqual(item.name, long_name)
            self.assertEqual(len(item.name), 31)
            self.assertTrue(item.isfile)

            # Проверяем содержимое
            with reader.open(item) as s:
                content = s.read()
                self.assertEqual(content, test_data)

    def test_special_characters_in_filenames(self):
        """Тест специальных символов в именах файлов"""
        temp_file = os.path.join(self.temp_dir, 'special_chars.cfb')

        special_names = [
            "file_with_underscore_test",
            "file-with-dash-test",
            "file.with.dots",
            "file123with456numbers",
            "fileWithMixedCase",
            "file_with_123_mixed"
        ]
        
        test_data = b'Special character test data'

        # Создаем файл с именами, содержащими специальные символы
        with CompoundFileWriter(temp_file) as writer:
            for name in special_names:
                writer.create_stream(writer.root, name, test_data)

        # Проверяем структуру файла
        with CompoundFileReader(temp_file) as reader:
            items = list(reader.root)
            self.assertEqual(len(items), len(special_names))

            for item in items:
                self.assertIn(item.name, special_names)
                self.assertTrue(item.isfile)

                # Проверяем содержимое
                with reader.open(item) as s:
                    content = s.read()
                    self.assertEqual(content, test_data)

    def test_zero_size_streams(self):
        """Тест потоков нулевого размера"""
        temp_file = os.path.join(self.temp_dir, 'zero_size_streams.cfb')

        # Создаем файл с потоками нулевого размера
        with CompoundFileWriter(temp_file) as writer:
            writer.create_stream(writer.root, "empty_stream_1", b'')
            writer.create_stream(writer.root, "empty_stream_2", b'')
            writer.create_stream(writer.root, "empty_stream_3", b'')

        # Проверяем структуру файла
        with CompoundFileReader(temp_file) as reader:
            items = list(reader.root)
            self.assertEqual(len(items), 3)

            for item in items:
                self.assertTrue(item.isfile)
                self.assertEqual(item.size, 0)

                # Проверяем, что содержимое действительно пустое
                with reader.open(item) as s:
                    content = s.read()
                    self.assertEqual(content, b'')

    def test_large_number_of_small_streams(self):
        """Тест большого количества маленьких потоков"""
        temp_file = os.path.join(self.temp_dir, 'many_small_streams.cfb')

        stream_count = 500
        test_data = b'X'  # Очень маленькие потоки

        # Создаем файл с большим количеством маленьких потоков
        with CompoundFileWriter(temp_file) as writer:
            for i in range(stream_count):
                writer.create_stream(writer.root, f'small_{i:03d}', test_data)

        # Проверяем структуру файла
        with CompoundFileReader(temp_file) as reader:
            items = list(reader.root)
            self.assertEqual(len(items), stream_count)

            for i, item in enumerate(items):
                expected_name = f'small_{i:03d}'
                self.assertEqual(item.name, expected_name)
                self.assertTrue(item.isfile)
                self.assertEqual(item.size, 1)  # Размер одного байта

                # Проверяем содержимое
                with reader.open(item) as s:
                    content = s.read()
                    self.assertEqual(content, test_data)

    def test_huge_stream(self):
        """Тест огромного потока"""
        temp_file = os.path.join(self.temp_dir, 'huge_stream.cfb')

        # Создаем очень большой поток (1MB)
        huge_data = b'H' * (1024 * 1024)  # 1 MB

        # Создаем файл с огромным потоком
        with CompoundFileWriter(temp_file) as writer:
            writer.create_stream(writer.root, "huge_stream", huge_data)

        # Проверяем структуру файла
        with CompoundFileReader(temp_file) as reader:
            items = list(reader.root)
            self.assertEqual(len(items), 1)

            item = items[0]
            self.assertEqual(item.name, 'huge_stream')
            self.assertTrue(item.isfile)
            self.assertEqual(item.size, len(huge_data))

            # Проверяем содержимое (только первые и последние байты для эффективности)
            with reader.open(item) as s:
                content = s.read()
                self.assertEqual(content, huge_data)

    def test_mixed_stream_sizes(self):
        """Тест потоков разных размеров"""
        temp_file = os.path.join(self.temp_dir, 'mixed_sizes.cfb')

        # Разные размеры потоков
        stream_specs = [
            (0, b''),  # Пустой поток
            (1, b'X'),  # Один байт
            (100, b'X' * 100),  # Маленький поток
            (512, b'Y' * 512),  # Ровно один сектор
            (513, b'Z' * 513),  # Чуть больше сектора
            (1024, b'A' * 1024),  # Несколько секторов
        ]

        # Создаем файл с потоками разных размеров
        with CompoundFileWriter(temp_file) as writer:
            for i, (size, data) in enumerate(stream_specs):
                writer.create_stream(writer.root, f'stream_{i}_{size}_bytes', data)

        # Проверяем структуру файла
        with CompoundFileReader(temp_file) as reader:
            items = list(reader.root)
            self.assertEqual(len(items), len(stream_specs))

            for i, (expected_size, expected_data) in enumerate(stream_specs):
                item = items[i]
                expected_name = f'stream_{i}_{expected_size}_bytes'
                
                self.assertEqual(item.name, expected_name)
                self.assertTrue(item.isfile)
                self.assertEqual(item.size, expected_size)

                # Проверяем содержимое
                with reader.open(item) as s:
                    content = s.read()
                    self.assertEqual(content, expected_data)