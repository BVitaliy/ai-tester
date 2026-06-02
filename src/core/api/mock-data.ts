import type { User, WPPost } from "../types"

export const delay = (ms = 300) => new Promise((r) => setTimeout(r, ms))

export const MOCK_USER: User = {
  id: "1",
  username: "dev",
  name: "Dev User"
}
export const MOCK_TOKEN = btoa("dev:mock-app-password")

export const MOCK_POSTS: WPPost[] = [
  {
    id: 46955,
    title: { rendered: "Активна панда" },
    slug: "aktyvna-panda",
    link: "https://documentation.redstone.studio/aktyvna-panda/",
    acf: {
      content: [
        {
          acf_fc_layout: "element",
          type: "nosubs",
          show_in_menu: true,
          show_content_editor: true,
          content_title: "ЗМІСТ",
          content_main: "<p>Вступний текст документації.</p>",
          content_sub: null
        },
        {
          acf_fc_layout: "element",
          type: "subs",
          show_in_menu: true,
          show_content_editor: true,
          content_title: "Загальні положення",
          content_main:
            "<p>Загальна інформація про роботу з адмін-панеллю.</p>",
          content_sub: [
            {
              content_subtitle: "Панель керування",
              subcontent:
                "<p>Перейшовши в адмін-панель, ліворуч бачимо перелік основних розділів сайту.</p>"
            },
            {
              content_subtitle: "Пошук, фільтри, групові дії",
              subcontent:
                "<p>Майже у кожному розділі є пошук, фільтри, та можливість здійснювати групові дії.</p>"
            },
            {
              content_subtitle:
                "Додавання, видалення, та переміщення елементів",
              subcontent:
                "<p>На деяких сторінках є можливість додати/видалити якийсь елемент, а також пересунути його.</p>"
            },
            {
              content_subtitle: "Навігація",
              subcontent:
                "<p>При наведенні мишкою на елемент для кожного можна застосувати декілька дій.</p>"
            }
          ]
        },
        {
          acf_fc_layout: "element",
          type: "subs",
          show_in_menu: true,
          show_content_editor: true,
          content_title: "НАЛАШТУВАННЯ САЙТУ",
          content_main: "",
          content_sub: [
            {
              content_subtitle: "Загальні налаштування",
              subcontent:
                "<p>Налаштування → Загальні. Тут можна змінити назву сайту та часовий пояс.</p>"
            },
            {
              content_subtitle: "Постійні посилання",
              subcontent:
                "<p>Налаштування → Постійні посилання. Рекомендується обрати «Назва запису».</p>"
            }
          ]
        },
        {
          acf_fc_layout: "element",
          type: "subs",
          show_in_menu: true,
          show_content_editor: true,
          content_title: "ЗАПИСИ",
          content_main: "",
          content_sub: [
            {
              content_subtitle: "Додавання запису",
              subcontent:
                "<p>Записи → Додати новий. Введіть заголовок та вміст.</p>"
            }
          ]
        }
      ]
    }
  },
  {
    id: 47001,
    title: { rendered: "Інтернет-магазин Rozetka" },
    slug: "internet-magazyn-rozetka",
    link: "https://documentation.redstone.studio/internet-magazyn-rozetka/",
    acf: {
      content: [
        {
          acf_fc_layout: "element",
          type: "nosubs",
          show_in_menu: true,
          show_content_editor: true,
          content_title: "Вступ",
          content_main: "<p>Документація інтернет-магазину.</p>",
          content_sub: null
        },
        {
          acf_fc_layout: "element",
          type: "subs",
          show_in_menu: true,
          show_content_editor: true,
          content_title: "Управління товарами",
          content_main: "",
          content_sub: [
            {
              content_subtitle: "Додавання товару",
              subcontent: "<p>Товари → Додати новий товар.</p>"
            },
            {
              content_subtitle: "Редагування ціни",
              subcontent:
                "<p>Відкрийте товар та знайдіть блок «Дані товару».</p>"
            }
          ]
        }
      ]
    }
  }
]

export const MOCK_POSTS_MUTABLE: WPPost[] = JSON.parse(
  JSON.stringify(MOCK_POSTS)
)
