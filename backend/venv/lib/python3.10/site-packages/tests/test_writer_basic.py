"""
Тесты для записи OLE Compound Document файлов
"""
import unittest
import os
import tempfile
import sys
import io
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from compoundfiles.writer import CompoundFileWriter
from compoundfiles.reader import CompoundFileReader


class TestWriterBasic(unittest.TestCase):
    """Базовые тесты для записи файлов Compound File"""

    def setUp(self):
        """Подготовка тестового окружения"""
        self.temp_dir = tempfile.mkdtemp()

    def tearDown(self):
        """Очистка после тестов"""
        # Удаление временных файлов
        for file in os.listdir(self.temp_dir):
            os.remove(os.path.join(self.temp_dir, file))
        os.rmdir(self.temp_dir)

    def test_create_simple_file(self):
        """Тест создания простого файла"""
        temp_file = os.path.join(self.temp_dir, 'simple_test.cfb')

        # Создаем файл с помощью CompoundFileWriter
        with CompoundFileWriter(temp_file) as writer:
            test_data = b'Hello, Compound File!'
            writer.create_stream(writer.root, "test_stream", test_data)

        # Проверяем, что файл был создан
        self.assertTrue(os.path.exists(temp_file))

        # Проверяем, что файл может быть прочитан
        with CompoundFileReader(temp_file) as cfr:
            # Проверяем, что есть хотя бы один элемент
            items = list(cfr.root)
            self.assertEqual(len(items), 1)

            # Проверяем, что это поток
            item = items[0]
            self.assertTrue(item.isfile)
            self.assertEqual(item.name, 'test_stream')
            self.assertEqual(item.size, len(test_data))

            # Проверяем содержимое
            with cfr.open(item) as stream:
                content = stream.read()
                self.assertEqual(content, test_data)

    def test_create_file_with_storage(self):
        """Тест создания файла с хранилищем (каталогом)"""
        temp_file = os.path.join(self.temp_dir, 'storage_test.cfb')

        # Создаем файл с помощью CompoundFileWriter
        with CompoundFileWriter(temp_file) as writer:
            # Создаем подкаталог
            subdir = writer.create_storage(writer.root, "subdir")
            test_data = b'Subdir content'
            # Создаем поток в подкаталоге
            writer.create_stream(subdir, "sub_stream", test_data)

        # Проверяем, что файл был создан
        self.assertTrue(os.path.exists(temp_file))

        # Проверяем структуру
        with CompoundFileReader(temp_file) as cfr:
            # Проверяем, что есть подкаталог
            items = list(cfr.root)
            self.assertEqual(len(items), 1)

            subdir = items[0]
            self.assertTrue(subdir.isdir)
            self.assertEqual(subdir.name, 'subdir')

            # Проверяем содержимое подкаталога
            subdir_items = list(subdir)
            self.assertEqual(len(subdir_items), 1)

            sub_stream = subdir_items[0]
            self.assertTrue(sub_stream.isfile)
            self.assertEqual(sub_stream.name, 'sub_stream')
            self.assertEqual(sub_stream.size, len(test_data))

            # Проверяем содержимое
            with cfr.open(sub_stream) as stream:
                content = stream.read()
                self.assertEqual(content, test_data)

    def test_create_multiple_streams(self):
        """Тест создания нескольких потоков"""
        temp_file = os.path.join(self.temp_dir, 'multi_stream_test.cfb')

        # Создаем файл с помощью CompoundFileWriter
        with CompoundFileWriter(temp_file) as writer:
            # Создаем несколько потоков
            streams_data = {
                'stream1': b'Data for stream 1',
                'stream2': b'Data for stream 2',
                'stream3': b'Data for stream 3'
            }

            for name, data in streams_data.items():
                writer.create_stream(writer.root, name, data)

        # Проверяем, что файл был создан
        self.assertTrue(os.path.exists(temp_file))

        # Проверяем содержимое
        with CompoundFileReader(temp_file) as cfr:
            items = list(cfr.root)
            self.assertEqual(len(items), 3)

            for item in items:
                self.assertTrue(item.isfile)
                self.assertIn(item.name, streams_data.keys())

                # Проверяем содержимое каждого потока
                with cfr.open(item) as stream:
                    content = stream.read()
                    self.assertEqual(content, streams_data[item.name])

    def test_create_nested_storages(self):
        """Тест создания вложенных хранилищ"""
        temp_file = os.path.join(self.temp_dir, 'nested_test.cfb')

        # Создаем файл с помощью CompoundFileWriter
        with CompoundFileWriter(temp_file) as writer:
            # Создаем вложенную структуру
            level1 = writer.create_storage(writer.root, "level1")
            level2 = writer.create_storage(level1, "level2")

            # Создаем поток во втором уровне
            test_data = b'Nested content'
            writer.create_stream(level2, "nested_stream", test_data)

        # Проверяем, что файл был создан
        self.assertTrue(os.path.exists(temp_file))

        # Проверяем структуру
        with CompoundFileReader(temp_file) as cfr:
            # Проверяем первый уровень
            items = list(cfr.root)
            self.assertEqual(len(items), 1)

            lvl1 = items[0]
            self.assertTrue(lvl1.isdir)
            self.assertEqual(lvl1.name, 'level1')

            # Проверяем второй уровень
            lvl1_items = list(lvl1)
            self.assertEqual(len(lvl1_items), 1)

            lvl2 = lvl1_items[0]
            self.assertTrue(lvl2.isdir)
            self.assertEqual(lvl2.name, 'level2')

            # Проверяем поток
            lvl2_items = list(lvl2)
            self.assertEqual(len(lvl2_items), 1)

            stream = lvl2_items[0]
            self.assertTrue(stream.isfile)
            self.assertEqual(stream.name, 'nested_stream')
            self.assertEqual(stream.size, len(test_data))

            # Проверяем содержимое
            with cfr.open(stream) as s:
                content = s.read()
                self.assertEqual(content, test_data)

    def test_empty_stream(self):
        """Тест создания пустого потока"""
        temp_file = os.path.join(self.temp_dir, 'empty_stream_test.cfb')

        # Создаем файл с помощью CompoundFileWriter
        with CompoundFileWriter(temp_file) as writer:
            # Создаем пустой поток
            writer.create_stream(writer.root, "empty_stream", b'')

        # Проверяем, что файл был создан
        self.assertTrue(os.path.exists(temp_file))

        # Проверяем содержимое
        with CompoundFileReader(temp_file) as cfr:
            items = list(cfr.root)
            self.assertEqual(len(items), 1)

            stream = items[0]
            self.assertTrue(stream.isfile)
            self.assertEqual(stream.name, 'empty_stream')
            self.assertEqual(stream.size, 0)

            # Проверяем содержимое
            with cfr.open(stream) as s:
                content = s.read()
                self.assertEqual(content, b'')

    def test_large_stream(self):
        """Тест создания большого потока"""
        temp_file = os.path.join(self.temp_dir, 'large_stream_test.cfb')

        # Создаем большой объем данных (больше размера сектора)
        large_data = b'This is a large amount of data. ' * 1000

        # Создаем файл с помощью CompoundFileWriter
        with CompoundFileWriter(temp_file) as writer:
            writer.create_stream(writer.root, "large_stream", large_data)

        # Проверяем, что файл был создан
        self.assertTrue(os.path.exists(temp_file))

        # Проверяем содержимое
        with CompoundFileReader(temp_file) as cfr:
            items = list(cfr.root)
            self.assertEqual(len(items), 1)

            stream = items[0]
            self.assertTrue(stream.isfile)
            self.assertEqual(stream.name, 'large_stream')
            self.assertEqual(stream.size, len(large_data))

            # Проверяем содержимое
            with cfr.open(stream) as s:
                content = s.read()
                self.assertEqual(content, large_data)

    def test_file_like_object(self):
        """Тест записи в file-like объект"""
        # Создаем BytesIO объект
        bio = io.BytesIO()

        # Создаем файл с помощью CompoundFileWriter
        with CompoundFileWriter(bio) as writer:
            test_data = b'File-like object test'
            writer.create_stream(writer.root, "file_like_stream", test_data)

        # Получаем содержимое
        file_contents = bio.getvalue()

        # Записываем в файл для проверки чтения
        temp_file = os.path.join(self.temp_dir, 'file_like_test.cfb')
        with open(temp_file, 'wb') as f:
            f.write(file_contents)

        # Проверяем, что файл был создан
        self.assertTrue(os.path.exists(temp_file))

        # Проверяем содержимое
        with CompoundFileReader(temp_file) as cfr:
            items = list(cfr.root)
            self.assertEqual(len(items), 1)

            stream = items[0]
            self.assertTrue(stream.isfile)
            self.assertEqual(stream.name, 'file_like_stream')
            self.assertEqual(stream.size, len(test_data))

            # Проверяем содержимое
            with cfr.open(stream) as s:
                content = s.read()
                self.assertEqual(content, test_data)


if __name__ == '__main__':
    unittest.main()